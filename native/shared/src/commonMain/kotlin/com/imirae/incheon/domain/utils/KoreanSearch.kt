package com.imirae.incheon.domain.utils

object KoreanSearch {
    private val CHOSUNG = charArrayOf(
        '\u3131','\u3132','\u3134','\u3137','\u3138','\u3139','\u3141','\u3142','\u3143',
        '\u3145','\u3146','\u3147','\u3148','\u3149','\u314A','\u314B','\u314C','\u314D','\u314E'
    )
    fun getChosung(text: String): String = text.map { ch ->
        if (ch in '\uAC00'..'\uD7A3') CHOSUNG[((ch - '\uAC00') / 588)] else ch
    }.joinToString("")
    fun matchesChosung(text: String, query: String): Boolean {
        if (query.isBlank()) return true
        val chosung = getChosung(text)
        return chosung.contains(query, ignoreCase = true) || text.contains(query, ignoreCase = true)
    }
}
