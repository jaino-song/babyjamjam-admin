package com.imirae.incheon.di

import com.imirae.incheon.auth.AuthManager
import com.imirae.incheon.auth.SecureStorage
import com.imirae.incheon.auth.SessionPolicy
import com.imirae.incheon.auth.StepUpAuth
import com.imirae.incheon.data.remote.*
import com.imirae.incheon.network.ApiClient
import com.imirae.incheon.viewmodel.AuthViewModel
import org.koin.dsl.module

val networkModule = module {
    single { ApiClient(baseUrl = "https://api.imirae-incheon.com", tokenProvider = get<AuthManager>()) }
}

val serviceModule = module {
    single<AuthService> { AuthServiceImpl(get()) }
    single<ClientService> { ClientServiceImpl(get()) }
    single<EmployeeService> { EmployeeServiceImpl(get()) }
    single<DocumentService> { DocumentServiceImpl(get()) }
    single<TemplateService> { TemplateServiceImpl(get()) }
    single<ChatService> { ChatServiceImpl(get()) }
    single<NotificationService> { NotificationServiceImpl(get()) }
    single<FileService> { FileServiceImpl(get()) }
    single<SettingsService> { SettingsServiceImpl(get()) }
}

val authModule = module {
    single { AuthManager(get(), get()) }
    single { SessionPolicy(get()) }
    single { StepUpAuth(get()) }
    single { AuthViewModel(get()) }
}

val sharedModules = listOf(networkModule, serviceModule, authModule)
