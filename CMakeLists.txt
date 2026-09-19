cmake_minimum_required(VERSION 3.8)
project(procfs-wla VERSION 1.0.1 LANGUAGES C)

include(GNUInstallDirs)

find_program(NPM_EXECUTABLE npm REQUIRED)
mark_as_advanced(NPM_EXECUTABLE)

if (WIN32)
  set(NPM_PREFIX "cmd" "/c")
endif ()

find_package(LibNetQ REQUIRED)

option(PROCFS_INSTALL_SERVER "Install the procfs server" ON)
option(PROCFS_INSTALL_MODULE "Install the procfs module" ON)
option(PROCFS_INSTALL_ASSETS "Install procfs supporting assets" ON)

set(PROCFS_BASE_DIR "/proc" CACHE STRING "Filesystem directory served by the procfs module")
set(PROCFS_BASE_URL "/" CACHE STRING "URL path prefix the procfs module is served under (a trailing slash is appended if missing)")

set(PROCFS_ASSETS_DIR "${CMAKE_INSTALL_DATADIR}/${PROJECT_NAME}")

set(PROCFS_ROOT_URL "${PROCFS_BASE_URL}")
if(NOT PROCFS_ROOT_URL MATCHES "/$")
  set(PROCFS_ROOT_URL "${PROCFS_ROOT_URL}/")
  set(PROCFS_USE_BASE_URL ON)
endif()

set(PROCFS_SERVICE_URL "${PROCFS_ROOT_URL}0")
set(PROCFS_DIRAPI_URL  "${PROCFS_SERVICE_URL}/api/dir")
set(PROCFS_FILEAPI_URL "${PROCFS_SERVICE_URL}/api/file")

set(PROCFS_FILE_HTML "file.html")
set(PROCFS_DIR_HTML "dir.html")

set(PROCFS_DATAFILES
  config.h.in
  )

file(GLOB_RECURSE PROCFS_TSXFILES
  "src/*.ts"
  "src/*.tsx"
  )

set(PROCFS_DISTFILES
  dist/index.html
  dist/manifest.json
  )

add_custom_command(
  COMMAND ${NPM_PREFIX} "${NPM_EXECUTABLE}" install
  COMMAND ${NPM_PREFIX} "${NPM_EXECUTABLE}" run build --base-url=${PROCFS_BASE_URL}
  DEPENDS package.json ${PROCFS_TSXFILES}
  OUTPUT ${PROCFS_DISTFILES}
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  )

configure_file(config.h.in "${CMAKE_CURRENT_BINARY_DIR}/config.h" @ONLY)

source_group(TREE "${CMAKE_CURRENT_SOURCE_DIR}" FILES module.c ${PROCFS_DATAFILES} ${PROCFS_DISTFILES})
add_library(procfs_wla SHARED module.c ${PROCFS_DATAFILES} ${PROCFS_DISTFILES})
target_include_directories(procfs_wla PRIVATE "$<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}>")
target_link_libraries(procfs_wla PUBLIC LibNetQ::LibNetQ)
set_property(TARGET procfs_wla PROPERTY POSITION_INDEPENDENT_CODE ON)
set_target_properties(procfs_wla PROPERTIES PREFIX "" IMPORT_PREFIX "")

source_group(TREE "${CMAKE_CURRENT_SOURCE_DIR}" FILES server.c)
add_executable(procfs_server server.c)
target_link_libraries(procfs_server PRIVATE LibNetQ::LibNetQ)

if (CMAKE_C_COMPILER_ID MATCHES "^(GNU|Clang)$")
  target_link_options(procfs_server PRIVATE "-Wl,-rpath,$ORIGIN/../lib")
endif ()

if (PROCFS_INSTALL_SERVER)
  install(TARGETS procfs_server
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    )
endif ()

if (PROCFS_INSTALL_MODULE)
  install(TARGETS procfs_wla
    LIBRARY DESTINATION ${CMAKE_INSTALL_BINDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    )
endif ()

if (PROCFS_INSTALL_ASSETS)
  install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/dist/"
    DESTINATION "${PROCFS_ASSETS_DIR}"
    )
endif ()
