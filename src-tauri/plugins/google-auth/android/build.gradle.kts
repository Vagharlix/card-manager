plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.cardmanager.googleauth"
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
    // connexion Google native (Identity AuthorizationClient)
    implementation("com.google.android.gms:play-services-auth:21.5.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation(project(":tauri-android"))
}
