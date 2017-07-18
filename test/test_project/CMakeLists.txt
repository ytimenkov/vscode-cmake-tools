cmake_minimum_required(VERSION 3.1)
project(TestProject)

include(CMakeToolsHelpers OPTIONAL)

add_executable(MyExecutable main.cpp another.cpp)

include(CTest)
enable_testing()
set(CTEST_BINARY_DIRECTORY "${CMAKE_BINARY_DIR}")

if(DEFINED WARNING_COOKIE)
    message(WARNING "${WARNING_COOKIE}")
endif()

if(WIN32)
    set(home "$ENV{PROFILE}")
else()
    set(home "$ENV{HOME}")
endif()

message(STATUS "HOME is ${home}")
set(ENV_HOME "${home}" CACHE STRING "For testing" FORCE)

# Part of backend test
message(STATUS "CMT_BACKEND_TEST_ENV_VAR=$ENV{CMT_BACKEND_TEST_ENV_VAR}")
message(STATUS "CMT_BACKEND_TEST_CONFIGURE_VAR=${CMT_BACKEND_TEST_CONFIGURE_VAR}")

add_test(AnExampleTest MyExecutable)

if(CAUSE_BUILD_ERROR)
    target_compile_definitions(MyExecutable PRIVATE CMT_DO_BUILD_ERROR)
endif()

if ($ENV{CAUSE_CONFIG_ERROR})
    message(FATAL_ERROR "Injected failure")
endif()

if(MSVC)
    target_compile_definitions(MyExecutable PRIVATE _CRT_SECURE_NO_WARNINGS)
else()
    target_compile_options(MyExecutable PRIVATE -fprofile-arcs -ftest-coverage)
    target_link_libraries(MyExecutable PRIVATE --coverage)
endif()

add_library(some-interface-lib INTERFACE)