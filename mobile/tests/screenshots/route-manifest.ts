export type ScreenshotRoute = {
  slug: string;
  path: string;
  auth: "public" | "authenticated";
};

export const mobileScreenshotRoutes: ScreenshotRoute[] = [
  { slug: "home", path: "/", auth: "public" },
  { slug: "callback", path: "/callback", auth: "public" },
  { slug: "forgot-password", path: "/forgot-password", auth: "public" },
  { slug: "login", path: "/login", auth: "public" },
  { slug: "register", path: "/register", auth: "public" },
  { slug: "reset-password", path: "/reset-password", auth: "public" },
  { slug: "verify-email", path: "/verify-email", auth: "public" },

  { slug: "admin", path: "/admin", auth: "authenticated" },
  { slug: "admin-feedback", path: "/admin/feedback", auth: "authenticated" },
  { slug: "alimtalk", path: "/alimtalk", auth: "authenticated" },
  { slug: "all", path: "/all", auth: "authenticated" },
  { slug: "chat", path: "/chat", auth: "authenticated" },
  { slug: "clients", path: "/clients", auth: "authenticated" },
  { slug: "clients-new", path: "/clients/new", auth: "authenticated" },
  { slug: "contracts", path: "/contracts", auth: "authenticated" },
  { slug: "contracts-creation", path: "/contracts/creation", auth: "authenticated" },
  { slug: "dashboard", path: "/dashboard", auth: "authenticated" },
  { slug: "employees", path: "/employees", auth: "authenticated" },
  { slug: "employees-new", path: "/employees/new", auth: "authenticated" },
  { slug: "files", path: "/files", auth: "authenticated" },
  { slug: "logout", path: "/logout", auth: "authenticated" },
  { slug: "messages", path: "/messages", auth: "authenticated" },
  { slug: "messages-system-templates", path: "/messages/system-templates", auth: "authenticated" },
  { slug: "messages-templates", path: "/messages/templates", auth: "authenticated" },
  { slug: "messages-templates-new", path: "/messages/templates/new", auth: "authenticated" },
  { slug: "select-organization", path: "/select-organization", auth: "authenticated" },
  { slug: "settings", path: "/settings", auth: "authenticated" },
  { slug: "test", path: "/test", auth: "authenticated" },
];

export const mobileDynamicScreenshotRoutes: ScreenshotRoute[] = [
  { slug: "admin-feedback-detail", path: "/admin/feedback/feedback-1", auth: "authenticated" },
  { slug: "messages-system-template-detail", path: "/messages/system-templates/THANKS", auth: "authenticated" },
  { slug: "messages-template-edit", path: "/messages/templates/tpl-1/edit", auth: "authenticated" },
];
