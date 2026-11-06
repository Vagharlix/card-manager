fn main() {
    // Recompile when VITE_TEST_MODE changes so option_env!("VITE_TEST_MODE")
    // in lib.rs always reflects the current build (test vs normal).
    println!("cargo:rerun-if-env-changed=VITE_TEST_MODE");
    tauri_build::build()
}