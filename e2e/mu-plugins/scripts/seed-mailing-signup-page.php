<?php
/**
 * Seed a published page carrying the fair-audience mailing-signup block.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-mailing-signup-page.php
 *
 * Prints a single `E2E_MAILING_SIGNUP_PAGE:{json}` line with the page id + permalink.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Mailing Signup ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ),
		'post_content' => '<!-- wp:fair-audience/mailing-signup /-->',
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create mailing signup page: ' . $page_id->get_error_message() );
}

echo 'E2E_MAILING_SIGNUP_PAGE:' . wp_json_encode(
	array(
		'pageId'  => (int) $page_id,
		'pageUrl' => get_permalink( $page_id ),
	)
) . "\n";
