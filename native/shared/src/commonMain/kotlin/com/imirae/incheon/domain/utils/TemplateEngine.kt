package com.imirae.incheon.domain.utils

object TemplateEngine {
    private val variableRegex = Regex("\\{\\{(\\w+)\\}\\}")
    fun render(template: String, variables: Map<String, String>): String {
        return variableRegex.replace(template) { match -> variables[match.groupValues[1]] ?: match.value }
    }
    fun extractVariables(template: String): List<String> {
        return variableRegex.findAll(template).map { it.groupValues[1] }.distinct().toList()
    }
}
