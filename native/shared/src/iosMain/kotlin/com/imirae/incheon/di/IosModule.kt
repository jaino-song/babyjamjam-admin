package com.imirae.incheon.di
import com.imirae.incheon.auth.SecureStorage
import com.imirae.incheon.viewmodel.AuthViewModel
import org.koin.core.component.KoinComponent
import org.koin.core.component.get
import org.koin.dsl.module
val iosModule = module { single { SecureStorage() } }
fun getAuthViewModel(): AuthViewModel = object : KoinComponent {}.get()
