import { IsNotEmpty, IsUUID } from 'class-validator';

export class SelectOrganizationDto {
    @IsUUID()
    @IsNotEmpty({ message: '조직 ID는 필수입니다.' })
    organizationId!: string;
}

export class SwitchOrganizationDto {
    @IsUUID()
    @IsNotEmpty({ message: '현재 조직 ID는 필수입니다.' })
    currentOrganizationId!: string;

    @IsUUID()
    @IsNotEmpty({ message: '새 조직 ID는 필수입니다.' })
    newOrganizationId!: string;
}
