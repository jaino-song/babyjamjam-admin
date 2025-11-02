export declare class CreateUserDto {
    kakaoId: string;
    name?: string;
    email?: string;
    profileImage?: string;
}
export declare class UpdateUserDto {
    name?: string | null;
    email?: string | null;
    profileImage?: string | null;
    role?: string | null;
}
