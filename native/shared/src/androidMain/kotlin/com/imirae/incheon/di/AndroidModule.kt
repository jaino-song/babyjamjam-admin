package com.imirae.incheon.di
import com.imirae.incheon.auth.SecureStorage
import org.koin.android.ext.koin.androidContext
import org.koin.dsl.module
val androidModule = module { single { SecureStorage(androidContext()) } }
