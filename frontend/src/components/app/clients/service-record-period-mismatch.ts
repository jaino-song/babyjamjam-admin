/** Particle for a numeric date read in Korean (일·칠·팔 end in ㄹ). */
export function dateDirectionParticle(date: string): "로" | "으로" {
    return "1245789".includes(date.slice(-1)) ? "로" : "으로";
}
