// RUN npx bitmake build

const environment = {};
const prefix = "/package";
const destDir = "${binaryRoot}";

export default {
  "bundle:zlib": {
    sourceUrl: "https://zlib.net/zlib-1.3.2.tar.gz",
    action: "configure",
    variables: {
      prefix,
    },
    features: [
      "static",
    ],
    environment,
    destDir,
  },
  "bundle:openssl": {
    sourceUrl: "https://github.com/openssl/openssl/releases/download/openssl-3.4.0/openssl-3.4.0.tar.gz",
    action: [
      {
        action: "process",
        command: "./Configure",
        args: [
          "zlib",
          "threads",
          "no-shared",
          "no-legacy",
          "no-apps",
          "no-docs",
          "no-tests",
          `--prefix=${prefix}`,
          `--openssldir=${prefix}/etc/ssl`,
          "--with-zlib-include=" + destDir + `${prefix}/include`,
          "--with-zlib-lib=" + destDir + `${prefix}/lib`,
          "--libdir=lib",
        ],
      },
      {
        action: "make",
        args: [ "install" ],
      },
    ],
    binaryDir: "${sourceDir}",
    environment,
    destDir,
  },
  "bundle:libmicrohttpd": {
    sourceUrl: "https://mirror.ibcp.fr/pub/gnu/libmicrohttpd/libmicrohttpd-0.9.77.tar.gz",
    action: "configure",
    variables: {
      prefix,
    },
    features: [
      "disable-shared",
      "with-pic",
    ],
    environment,
    destDir,
  },
  "bundle:cjson": {
    sourceUrl: "https://github.com/DaveGamble/cJSON/archive/refs/tags/v1.7.19.tar.gz",
    action: "cmake",
    cacheVariables: {
      CMAKE_POLICY_VERSION_MINIMUM: 3.5,
      CMAKE_PREFIX_PATH: destDir + prefix,
      CMAKE_INSTALL_PREFIX: prefix,
      BUILD_SHARED_LIBS: false,
      ENABLE_TARGET_EXPORT: false,
      ENABLE_CJSON_TEST: false,
    },
    environment,
    destDir,
  },
  "bundle:libnetq": {
    sourceUrl: "https://github.com/libnetq/libnetq/archive/refs/tags/v1.0.19.tar.gz",
    action: "cmake",
    cacheVariables: {
      CMAKE_PREFIX_PATH: destDir + prefix,
      CMAKE_INSTALL_PREFIX: prefix,
      LNQ_LIBRARY_TYPE: "SHARED",
      LNQ_WITH_ZLIB: true,
      LNQ_WITH_OPENSSL: true,
      LNQ_WITH_CJSON: true,
      LNQ_WITH_MHD: true,
    },
    environment,
    destDir,
  },
  "bundle:output": {
    action: "cmake",
    cacheVariables: {
      CMAKE_MODULE_PATH: destDir + `${prefix}/share/libnetq/cmake`,
      CMAKE_PREFIX_PATH: destDir + prefix,
      CMAKE_INSTALL_PREFIX: prefix,
    },
    sourceDir: "${sourceRoot}",
    environment,
    destDir,
    rebuild: true,
  },
};
