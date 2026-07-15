package com.imirae.incheon.network
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.darwin.Darwin
actual fun platformEngine(): HttpClientEngine = Darwin.create()
