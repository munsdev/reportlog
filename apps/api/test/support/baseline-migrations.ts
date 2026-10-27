/**
 * The migrations that were on `main` when the free-text and redesign build
 * began (d34ba03, 27 October 2026), with the SHA-256 of each file's text.
 *
 * A FIXED SET, on purpose. Every file NOT in this list is "new", and the
 * migration guard (test/unit/migration-guard.test.ts) holds it to additions
 * only. The upgrade test (test/db/upgrade.test.ts) builds its starting
 * database from exactly these files, so it stays "the database as it was
 * today" however many migrations arrive after.
 *
 * The checksums make an edit to one of these files a failing test here, not
 * only a refusal by the runner on a server that already applied it.
 *
 * Do not add to this list when you write a migration. It is a record of the
 * past, and it is only ever extended when a release is cut and the integrator
 * decides the new files are now "what is on main".
 */
export const BASELINE_MIGRATIONS: Readonly<Record<string, string>> = {
  '20261018000000_core.sql': '88818d4050e6a37772b1f7bc789ac868f5691c6e2ccff5170be78f4dc1973c9c',
  '20261018120000_identity.sql': '5a893ea599c96c5aa5f7cb0390828fe84155c3a2fdec42b3bc2df46bc2df2ce1',
  '20261018120000_logbook_lifecycle.sql':
    'a213ef4fa8561b1dd26b88c07d6d88963b3f2c7c5fa14e31a7aecad26908b2ef',
  '20261018120000_site.sql': '565b4bbff99a5909bfeb2ba969e925d852e344b2087fe1209764ba6ff824fd2a',
  '20261019124712_lists.sql': 'cd6f71c197c2103ca50815a735809f69a5d4d59d5d55975526f97ae682deef07',
  '20261019125038_filing.sql': '40987810adcc467bd07bb6fcbb7d3950fd5964153e2301786c592081ebacd0ba',
  '20261019180411_moderation.sql':
    '97efa53c5ceb9497b3cdeb31e261fd2de207cac021a9a9d68d799ba128e77a35',
  '20261019180450_site_feedback_digests.sql':
    'a2b49fb4088265abd37bfe8824b854222985d5beae26e0dc6e69951b82241663',
  '20261019180616_maps.sql': '193a3e244b6ad77297285bbdbb84b242ed96cc1589d34ea7803e6693a1d5d268',
  '20261019180914_anchor_runs.sql':
    '23a161539e392682c8fa9edc5825bfd1d5c877180c526ba3ece95852e4c3a96b',
  '20261019180938_files.sql': 'f05c2fe1d14b8950a9500addad83e6330b3ca7b014cb2b333d88bbda29ab81d2',
  '20261019184609_coordinator_corrections.sql':
    'ffbc65447d74e0a44100c1b5dd6333193bdaaefe0ecfc191204bfb6ff06ef0dd',
  '20261019185427_contact_key_rotation.sql':
    '305fa35c64e6e51c7ebea688de228b6f0ea5401fc58728e2a12237db6ab591eb',
  '20261019192523_moderation_files_to_f.sql':
    '676ae894b16b97b88248d74e4ce7ea9e8385d36308072cb1898aa916a0d58733',
  '20261019200151_moderation_extras.sql':
    '5afd15fb026b5e079a9425c6563d648c33b1bbaf05e6d89b6743c66d9514b629',
  '20261019200244_identity_leftovers.sql':
    '5676fbec9e4691766de2085a47fe2ba1769ceaf5f2256298a6b17bbcab9e0e3d',
  '20261019204508_files_freeze.sql':
    '797aa9015d7a352a44b1f2a548e12a22757ac521f1df4a8e0282405b53be8611',
  '20261019205443_site_dev_mode.sql':
    '0e98bfecefcbada2bdfa43016e78fc1ecd79332cb06e3bee17c235b86d422905',
  '20261019205538_list_search.sql':
    '19b86b590b882b7c5804dcf9878f1ee305ff94c110ac003a276f5177eba1014c',
  '20261019214115_close_invariant_gaps.sql':
    'dece209a5bc59b994d2f92ab3f6616c9a04cea0bff570f29912a7aa77e2088b4',
  '20261019220952_template_applied.sql':
    'db44102663a3079e357e592a3ef6366b8c20fb8faff263867895e51b1609c704',
  '20261020063140_distribution_switch.sql':
    'c8962469762b24b1b3b8742593dc662a462ed30ef394ba3f0ebfe748e9f95fee',
  '20261020064655_archive_downloads_audit.sql':
    '74f6530228c4d522b5e68a51af59a8e5284d34eb057bf57505bb198f8d47c800',
  '20261020112918_chain_file_access.sql':
    '94be3c2dcc5e11b9051180f56b0e3cb1244e24116a66ed8282f2e0d7499bb1bb',
  '20261020113100_evidence_and_refused_files.sql':
    'fcbe24f32d6e8cb6f67d321ea75d54170ffef97223307b5a50859e56d11508a1',
  '20261020164745_journalist_alerts.sql':
    '8a2a4b72d3d01c59cba028ef5a7db83e84bcdcca4320d2c1741b0ce0371af10e',
  '20261020172824_moderation_agreement_notices.sql':
    '7a367d4ece2805ff44bfddb5f6f9b11e6e2b55cef15aecb51cdce9847ab26fe9',
  '20261020172901_links.sql': '22fd34658fd6b6b9d83a54dd8d7177feda9cbee867ec3ddbd97baee953196dc5',
  '20261020173100_content_notice_decision_token.sql':
    '98a4dd34576098871c19866bf445ad2c6ec22d87c156960679ecd2198dec677e',
  '20261020182835_journalist_access.sql':
    '9193cdbc650276577c2d25a54660fdb69bcdbd485aa84bfef8c129958cb0ba23',
  '20261021052916_journalist_alert_pause.sql':
    '0e7bf99a49bd1d3a5b71885c1e63e8eff9571ff012d3e12fea7f80c5fdf67c79',
  '20261021111006_reword_after_launch.sql':
    'ec49dc568439151a0bdc5231a938b4e1cafc3f89c2210d33f097da153a786e8b',
  '20261021111719_strict_lists_and_link_types.sql':
    '5c7de897e913bb8fcf25dd8c029841496735728909c727a955583b6ad2271e23',
  '20261021111901_two_factor.sql':
    'cfdea8cb46d65671a183849253aa846a36e3888171ec6c297e44d3008b2662db',
  '20261021112233_flood_and_lanes.sql':
    '0b8e82945eded849cf678de6be23f02975f91ab68a8c524b00b675e13bfbb41a',
  '20261021131234_the_door.sql': 'a69e31d1ce7209b330731912713ac830908c34b68ebcfa24bd0631c063347af2',
  '20261021144719_small_area_threshold.sql':
    'e4e61e9e666df8a91b2fe1d173abd7119f5c930eb6e85aa9e12ef9ddb3350fe1',
  '20261022045623_look_library.sql':
    '292e5f577ee2e0c5d055ea9116f6c4f25146e1e16c91220a8c792b59dc75e541',
  '20261022080605_look_packs.sql':
    'c6f921359fc46bc6b151f96d57d663de95c20790cefb145fcf853327007cb7e1',
  '20261022154940_home_sections.sql':
    '863f1a1aecc7f5f38299da405bfdb0057662f9ec78ff5c89d7ce89f882ee0a74',
  '20261022155312_newsdesk_default.sql':
    'fe95adea2c32ff60f86165b0026bae72f9d6b9fd6dd8edf3f84ed8dce27b6eda',
  '20261022224614_publish_by_terms.sql':
    '3d8ff46721130e8e823507ae036c8b02118ac875f60d31c86253f79369898172',
  '20261022231800_map_floor_one.sql':
    '0f9e1e24e575a7522f05a7a4c30fa355251121d6f8d38b574652c6057b32e385',
  '20261023062712_small_area_floor_one.sql':
    'e4776140ffde229569f7b462925cec3078b1e7b8b0ec5ee8faa48b9ef0f4abef',
  '20261023083754_map_county_threshold.sql':
    '833b7e905c9ca17afa4f529daacb2fa60d2d09fea4aeffb9b9584382f3439f3f',
  '20261023105923_journalist_signup_without_alerts.sql':
    'd04daf15c1fa9c60255e7b25819394116076fe39b8890b4cbb57e7f78ddf8981',
  '20261023203611_user_roles_set.sql':
    'bb3d16c67ebcfbb6b13d6b74b5af873d24ecfe2df05418d2f3cf163d33fa5ea6',
  '20261025002702_social_accounts.sql':
    '8772c90b6cf372c3e65b564933bad3a3ad5ad3ecba3755ec1264eb65249ee46d',
  '20261025110453_list_write_back.sql':
    '5e5f2ad1e3f8bdb0c9a1a18464dfb0e70b2fe797f8ecd077f377b5088def0999',
  '20261025120228_social_float.sql':
    'fad1431e38a03bc475c154f1a5d3a1674fb5d99fe0583799ff55a6f76971d42b',
  '20261025120911_show_on_front.sql':
    '377ab350d3f5a5b5b988bd982d3165e5706df03389913c5a4495659a5a092377',
  '20261025181500_logbook_short_address.sql':
    'f43c2a5c3ac5d6b7d155f4152378b784ca0d5aa07c9e50538d5ea97376a9effa',
  '20261025232454_covers.sql': 'bfc9423c41af2c34d39dd9567b16aae32e16e8a0acad9ad522cb52ed0da788f5',
  '20261026101811_site_pages.sql':
    '9adf108ee84b3d897f377e5608d9811000c28a0ae666b1a5770f321e531c4026',
  '20261026124936_map_also_slots.sql':
    'c3f45c9128ec7f690f1514cc0d64338571f7352f108475e7914b8ee891abd019',
};
