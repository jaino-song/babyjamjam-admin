// Keep the feature-local import path stable while the shared package owns the
// template rendering semantics used by both web and mobile.
export {
    extractVariables,
    getUnresolvedKeys,
    renderTemplate,
} from "@babyjamjam/shared";
