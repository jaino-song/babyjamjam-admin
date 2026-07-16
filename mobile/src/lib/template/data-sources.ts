import {
    TEMPLATE_DATA_SOURCES,
    getTemplateDataSourceById,
    type TemplateDataSource,
} from "@babyjamjam/shared";

export type DataSource = TemplateDataSource;
export const DATA_SOURCES = TEMPLATE_DATA_SOURCES;
export const getDataSourceById = getTemplateDataSourceById;
