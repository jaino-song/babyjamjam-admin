export interface TemplateDataSource {
  id: string;
  label: string;
  endpoint: string;
  valueField: string;
  labelField: string;
}

export const TEMPLATE_DATA_SOURCES: TemplateDataSource[] = [
  {
    id: "areas",
    label: "지역 목록",
    endpoint: "/bank-account-infos",
    valueField: "areaId",
    labelField: "areaId",
  },
  {
    id: "employees",
    label: "직원 목록",
    endpoint: "/employees",
    valueField: "name",
    labelField: "name",
  },
];

export function getTemplateDataSourceById(id: string): TemplateDataSource | undefined {
  return TEMPLATE_DATA_SOURCES.find((dataSource) => dataSource.id === id);
}
