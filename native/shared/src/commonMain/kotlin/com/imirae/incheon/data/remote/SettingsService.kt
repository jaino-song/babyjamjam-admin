package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.*

interface SettingsService {
    suspend fun getSettings(): ApiResult<UserSettings>
    suspend fun updateSettings(settings: UserSettings): ApiResult<UserSettings>
    suspend fun getVoucherPrices(): ApiResult<List<VoucherPrice>>
}

class SettingsServiceImpl(private val client: ApiClient) : SettingsService {
    override suspend fun getSettings() = client.get<UserSettings>("/settings")
    override suspend fun updateSettings(settings: UserSettings) = client.put<UserSettings>("/settings") { setBody(settings) }
    override suspend fun getVoucherPrices() = client.get<List<VoucherPrice>>("/voucher-prices")
}
