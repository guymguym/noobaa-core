# Copyright (C) 2016 NooBaa
{
    'variables': {
        'cflags_warnings': [
            '-W',
            '-Wall',
            '-Wextra',
            '-Werror',
            # TODO GUYM - pedantic fails for gpfs_fcntl.h because ISO C++ forbids zero length arrays
            #'-Wpedantic',
            '-Wno-unused-parameter',
            # Can be removed when https://github.com/nodejs/nan/issues/953 is resolved.
            '-Wno-error=deprecated-declarations',
        ],
    },

    'target_defaults': {

        'cflags': ['<@(cflags_warnings)'],

        'conditions' : [
            [ 'OS=="mac"', {
                'xcode_settings': {
                    'WARNING_CFLAGS': ['<@(cflags_warnings)'],
                },
            }],
        ],
    },
}
