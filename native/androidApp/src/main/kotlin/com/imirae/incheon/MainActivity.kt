package com.imirae.incheon

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.navigation.compose.rememberNavController
import com.imirae.incheon.navigation.AppNavGraph
import com.imirae.incheon.ui.theme.ImiRaeTheme
import com.imirae.incheon.viewmodel.*
import org.koin.android.ext.android.get

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ImiRaeTheme {
                val navController = rememberNavController()
                AppNavGraph(
                    navController = navController,
                    authViewModel = get(),
                    dashboardViewModel = get(),
                    clientListViewModel = get(),
                    clientDetailViewModel = get(),
                    employeeListViewModel = get(),
                    contractListViewModel = get(),
                    messageTemplateViewModel = get(),
                    chatViewModel = get(),
                    fileListViewModel = get(),
                    settingsViewModel = get(),
                    adminViewModel = get()
                )
            }
        }
    }
}
