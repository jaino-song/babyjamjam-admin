#!/usr/bin/env bash
# Decide what one `main` run does to the LightNode passive standby, from the
# `standby-status` output and the git history of the checkout it runs in.
#
#   standby-decision.sh [status-file]     (status on stdin when no file is given)
#   environment: GITHUB_SHA  the 40-hex commit this run built
#                NEWER_PRIMARY_RELEASE  optional: `none`, or the 40-hex commit of a
#                  newer release that already deployed to Lightsail, as found by
#                  newer-primary-release.sh. When set it can only turn a `deploy`
#                  into `superseded`; it never overrides a `refuse`. A set but
#                  malformed value (including an empty one) is a refusal.
#
# Prints `decision=deploy|superseded|refuse` and a `reason=` line on stdout.
# `refuse` exits non-zero; deploy and superseded exit 0.
#
# The standby ends on the newest backend release that deployed to Lightsail.
# `main` commits that never built the backend leave gaps, so the comparison is
# by ancestry of the release recorded on the host, never against the head of
# `main`. A recorded release counts whether or not its container is healthy:
# an unhealthy host must not let an older queued run roll it backwards.
set -euo pipefail

readonly SHA_PATTERN='^[0-9a-f]{40}$'

decide() {
    printf 'decision=%s\nreason=%s\n' "$1" "$2"
}

refuse() {
    decide refuse "$1"
    exit 1
}

# Every path that would deploy goes through here: a release that is no longer the
# newest to have deployed to Lightsail must not reach the standby, whatever the
# ancestry says (history O->A->B with the standby still at O: A is not newest).
decide_deploy() {
    if [[ -n "${newer_primary:-}" && "$newer_primary" != none ]]; then
        decide superseded "the newer release $newer_primary already deployed to Lightsail"
        return 0
    fi
    decide deploy "$1"
}

status_value() {
    awk -F= -v wanted="$1" '$1 == wanted { count += 1; value = substr($0, length($1) + 2) }
        END { if (count == 1 && value != "") print value; else exit 1 }' <<<"$status_output"
}

main() {
    local status_output standby_release current_tag
    local sha="${GITHUB_SHA:-}"
    local newer_primary=""

    [[ "$sha" =~ $SHA_PATTERN ]] || refuse "GITHUB_SHA is not a 40-hex commit"
    if [[ -n "${NEWER_PRIMARY_RELEASE+set}" ]]; then
        newer_primary="$NEWER_PRIMARY_RELEASE"
        [[ "$newer_primary" == none || "$newer_primary" =~ $SHA_PATTERN ]] \
            || refuse "NEWER_PRIMARY_RELEASE is neither 'none' nor a 40-hex commit"
    fi
    if [[ "$#" -ge 1 ]]; then
        status_output="$(cat "$1")" || refuse "the standby status file could not be read"
    else
        status_output="$(cat)"
    fi

    [[ "$(status_value environment || true)" == fallback-server ]] \
        || refuse "standby status does not describe the Fallback Server"
    [[ "$(status_value public_routing || true)" == aws ]] \
        || refuse "standby status does not report the AWS public route"
    standby_release="$(status_value standby_release || true)"

    case "$standby_release" in
        none)
            decide_deploy "the standby has no release recorded"
            return 0
            ;;
        present | recorded-unhealthy) ;;
        *) refuse "standby_release '$standby_release' is missing, duplicated or unknown" ;;
    esac

    current_tag="$(status_value current_tag || true)"
    [[ "$current_tag" =~ $SHA_PATTERN ]] || refuse "the standby current_tag is missing or not a commit SHA"
    git cat-file -e "${current_tag}^{commit}" 2>/dev/null \
        || refuse "the standby release $current_tag is not in this repository's history"
    git cat-file -e "${sha}^{commit}" 2>/dev/null \
        || refuse "this commit $sha is not in the repository"

    if [[ "$current_tag" == "$sha" ]]; then
        if [[ "$standby_release" == recorded-unhealthy ]]; then
            decide_deploy "the standby records $sha but is not healthy; redeploying it is the recovery"
        else
            decide superseded "the standby already runs $sha"
        fi
        return 0
    fi
    if git merge-base --is-ancestor "$sha" "$current_tag"; then
        decide superseded "the standby release $current_tag already contains $sha"
        return 0
    fi
    if git merge-base --is-ancestor "$current_tag" "$sha"; then
        decide_deploy "the standby release $current_tag is an ancestor of $sha"
        return 0
    fi
    refuse "the standby release $current_tag has diverged from $sha"
}

main "$@"
