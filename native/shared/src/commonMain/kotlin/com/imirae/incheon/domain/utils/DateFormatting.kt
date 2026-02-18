package com.imirae.incheon.domain.utils

object DateFormatting {
    fun formatDate(isoDate: String?): String {
        if (isoDate == null) return ""
        return try { isoDate.substring(0, 10) } catch (_: Exception) { isoDate }
    }
    fun formatDateTime(isoDate: String?): String {
        if (isoDate == null) return ""
        return try { isoDate.substring(0, 16).replace("T", " ") } catch (_: Exception) { isoDate }
    }
    fun formatRelativeTime(isoDate: String?): String {
        if (isoDate == null) return ""
        return formatDate(isoDate) // Simplified; full impl needs platform time
    }
}
