FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/gradle/bin:$PATH

RUN apt-get update && apt-get install -y \
    openjdk-17-jdk \
    curl \
    wget \
    unzip \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Android SDK
RUN mkdir -p /opt/android-sdk/cmdline-tools \
    && wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
       -O /tmp/android.zip \
    && unzip -q /tmp/android.zip -d /opt/android-sdk/cmdline-tools \
    && mv /opt/android-sdk/cmdline-tools/cmdline-tools \
       /opt/android-sdk/cmdline-tools/latest \
    && rm /tmp/android.zip

RUN yes | sdkmanager --licenses >/dev/null || true \
    && sdkmanager \
       "platform-tools" \
       "platforms;android-35" \
       "build-tools;35.0.0"

# Gradle 8.9
RUN wget -q https://services.gradle.org/distributions/gradle-8.9-bin.zip \
       -O /tmp/gradle.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && mv /opt/gradle-8.9 /opt/gradle \
    && rm /tmp/gradle.zip

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]

