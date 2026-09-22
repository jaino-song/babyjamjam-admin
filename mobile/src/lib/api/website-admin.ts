import { api } from "@/lib/api/client";

export interface RibbonConfig {
  enabled: boolean;
  message: string;
  backgroundColor: string;
  textColor: string;
  linkText: string;
  linkHref: string;
  linkColor: string;
}

export async function getRibbonConfig(): Promise<RibbonConfig> {
  const { data } = await api.get("/settings/ribbon-config");
  return data as RibbonConfig;
}

export async function updateRibbonConfig(config: RibbonConfig): Promise<RibbonConfig> {
  const { data } = await api.put("/settings/ribbon-config", config);
  return data as RibbonConfig;
}
