import { IsNotEmpty, IsUUID } from 'class-validator';

export class SelectBranchDto {
    @IsUUID()
    @IsNotEmpty({ message: '지점 ID는 필수입니다.' })
    branchId!: string;
}

export class SwitchBranchDto {
    @IsUUID()
    @IsNotEmpty({ message: '현재 지점 ID는 필수입니다.' })
    currentBranchId!: string;

    @IsUUID()
    @IsNotEmpty({ message: '새 지점 ID는 필수입니다.' })
    newBranchId!: string;
}
