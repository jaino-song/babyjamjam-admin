export class OutOfPocketPriceInfoEntity {
    constructor(
        public readonly id: number,
        public readonly duration: number,
        public readonly fullPrice: string,
    ) {}
}
