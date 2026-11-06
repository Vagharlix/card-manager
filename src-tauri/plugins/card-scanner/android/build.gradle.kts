plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.cardmanager.cardscanner"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    // modèle latin embarqué dans l'APK : fonctionne hors ligne, sans Play Services
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation(project(":tauri-android"))
}
