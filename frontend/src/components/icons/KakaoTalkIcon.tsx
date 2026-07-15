import Image from "next/image";

export function KakaoTalkIcon({ className }: { className?: string }) {
    return (
        <Image
            src="/assets/icons/kakao-talk.png"
            alt="카카오톡"
            width={20}
            height={20}
            className={className}
        />
    );
}
