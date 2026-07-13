export interface DataSource {
    id: string;
    label: string;
    endpoint: string;
    valueField: string;
    labelField: string;
}

export const DATA_SOURCES: DataSource[] = [
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

export const getDataSourceById = (id: string): DataSource | undefined => {
    return DATA_SOURCES.find(ds => ds.id === id);
};
