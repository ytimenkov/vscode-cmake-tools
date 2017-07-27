cmake_minimum_required(VERSION 3.1)
project(TestProject)

include(CMakeToolsHelpers OPTIONAL)

configure_file(timestamp.h.in timestamp.h @ONLY)
include_directories(${CMAKE_CURRENT_BINARY_DIR})

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

if($ENV{CAUSE_BUILD_ERROR})
    target_compile_definitions(MyExecutable PRIVATE CMT_DO_BUILD_ERROR)
endif()

if ($ENV{CAUSE_CONFIG_ERROR})
    message(FATAL_ERROR "Injected failure")
endif()

if($ENV{CAUSE_BUILD_HANG})
    # Notify test that it is a good time to cancel the build.
    # Write start marker as a separate target because some generators
    # like Ninja may buffer whole output for single target.
    #
    # NOTE: It is good idea to have sleep longer than timeout in the test.
    add_custom_target(TimeoutStart USES_TERMINAL
        COMMAND ${CMAKE_COMMAND} -E echo "Start sleep"
    )
    add_custom_target(Timeout ALL USES_TERMINAL
        COMMAND ${CMAKE_COMMAND} -E sleep 11
        COMMAND ${CMAKE_COMMAND} -E echo "End sleep"
    )
    add_dependencies(Timeout TimeoutStart)
endif()

add_custom_target(SpecialTarget
    COMMAND ${CMAKE_COMMAND} -E echo "CMakeTools: Special Target"
    )

add_custom_target(PrintEnvironment
    COMMAND ${CMAKE_COMMAND} -E environment
    )

if(MSVC)
    target_compile_definitions(MyExecutable PRIVATE _CRT_SECURE_NO_WARNINGS)
else()
    target_compile_options(MyExecutable PRIVATE -fprofile-arcs -ftest-coverage)
    target_link_libraries(MyExecutable PRIVATE --coverage)
endif()

add_library(some-interface-lib INTERFACE)