// Builds the Huawei DevEco Studio plugin. DevEco Studio is built on IntelliJ
// IDEA Community, so this targets the standard IntelliJ Platform Gradle
// plugin against an IC platform version compatible with DevEco Studio's
// build-number range (see gradle.properties). No JetBrains Marketplace
// publish task is configured — this pass ships as a sideloadable ZIP only,
// same as the GitHub Release artifacts for the other two hosts.
plugins {
    id("org.jetbrains.kotlin.jvm") version "1.9.24"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        create(providers.gradleProperty("platformType"), providers.gradleProperty("platformVersion"))
        bundledPlugin("Git4Idea")
        instrumentationTools()
    }
    // Gson ships bundled with the IntelliJ Platform, but declaring it
    // explicitly keeps compileOnly resolution predictable across IDE
    // versions (mirrors System.Text.Json's explicit use on the VS host).
    compileOnly("com.google.code.gson:gson:2.10.1")
}

kotlin {
    jvmToolchain(17)
}

intellijPlatform {
    pluginConfiguration {
        id = providers.gradleProperty("pluginGroup")
        name = providers.gradleProperty("pluginName")
        version = providers.gradleProperty("pluginVersion")

        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = providers.gradleProperty("pluginUntilBuild")
        }
    }
}

tasks {
    // The shared webview bundle is staged into src/main/resources/webview by
    // `npm run build:deveco-assets` (scripts/copy-deveco-assets.mjs) before
    // this build runs — see deveco/BUILD.md.
    processResources {
        duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    }
}
