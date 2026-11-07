"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.START_DATE_CHANGE_MODES = void 0;
exports.isStartDateChangeMode = isStartDateChangeMode;
exports.START_DATE_CHANGE_MODES = ["CONFIRM_STARTED", "RESTART", "MOVE"];
function isStartDateChangeMode(value) {
    return typeof value === "string" && exports.START_DATE_CHANGE_MODES.includes(value);
}
