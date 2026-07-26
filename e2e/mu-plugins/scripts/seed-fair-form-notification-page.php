<?php
/**
 * Seed a published page carrying the Fair Form block for the
 * notification-email E2E suite (#1212).
 *
 * The admin notification's recipient is resolved server-side from the
 * block's own `notificationEmail`/`formId` attributes (post_content), so
 * each scenario needs real block markup rather than a plain page. Inner
 * question blocks are not needed — the spec posts answers directly to the
 * REST endpoint; only the wrapper block's attributes drive resolution.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-fair-form-notification-page.php \
 *     <notificationEmail> [formId] [noBlock]
 *
 * `notificationEmail` may be an empty string (quote it: '') to seed the
 * "empty notification email" scenario. Pass `1` as the third arg to omit the
 * Fair Form block entirely (the "no block on this page" scenario).
 *
 * Prints a single `E2E_FAIR_FORM_NOTIFICATION_PAGE:{json}` line.
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

$notification_email = isset( $args[0] ) ? (string) $args[0] : '';
$form_id            = isset( $args[1] ) && '' !== $args[1] ? (string) $args[1] : '';
$no_block           = isset( $args[2] ) && '1' === $args[2];

if ( $no_block ) {
	$content = '<!-- wp:paragraph --><p>No Fair Form block on this page.</p><!-- /wp:paragraph -->';
} else {
	$block_attrs = array( 'notificationEmail' => $notification_email );
	if ( '' !== $form_id ) {
		$block_attrs['formId'] = $form_id;
	}

	$content = '<!-- wp:fair-audience/fair-form ' . wp_json_encode( $block_attrs ) . ' /-->';
}

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Fair Form Notification ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ),
		'post_content' => $content,
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create page: ' . $page_id->get_error_message() );
}

echo 'E2E_FAIR_FORM_NOTIFICATION_PAGE:' . wp_json_encode(
	array(
		'pageId'            => (int) $page_id,
		'notificationEmail' => $notification_email,
		'formId'            => $form_id,
	)
) . "\n";
