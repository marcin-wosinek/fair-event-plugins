<?php
/**
 * Seed the Fair Form event-selector E2E spec (#2408).
 *
 * Creates two published events whose stored titles carry HTML entities the
 * way WordPress stores them (non-breaking spaces, texturized quotes, an
 * ampersand, encoded HTML-like text), each with one occurrence, plus a draft
 * page carrying an empty Fair Form block.
 *
 * Titles are written straight to the posts table after insertion, so kses
 * and sanitize filters can't normalize the entities this spec depends on.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-fair-form-event-selector.php
 *
 * Prints a single `E2E_FAIR_FORM_EVENT_SELECTOR:{json}` line. Clean up with
 * cleanup-event.php for each event and `wp post delete <pageId> --force`.
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/../lib/event-factory.php';

global $wpdb;

$stamp  = gmdate( 'YmdHis' ) . wp_rand( 1000, 9999 );
$titles = array(
	'nbsp'   => "E2E Selector {$stamp} Test&nbsp;event",
	'quoted' => "E2E Selector {$stamp} Minifesti &#8220;La&nbsp;Mutable&#8221; &amp; &lt;b&gt;Friends&lt;/b&gt;",
);

$events = array();
foreach ( $titles as $key => $stored_title ) {
	$event_id = fair_e2e_create_event( 'E2E Selector placeholder ' . $stamp );
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test fixture writes the stored form verbatim.
	$wpdb->update( $wpdb->posts, array( 'post_title' => $stored_title ), array( 'ID' => $event_id ) );
	clean_post_cache( $event_id );

	$events[ $key ] = array(
		'eventId'     => $event_id,
		'eventDateId' => fair_e2e_add_date( $event_id ),
		'storedTitle' => $stored_title,
	);
}

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'draft',
		'post_title'   => 'E2E Fair Form Event Selector ' . $stamp,
		'post_content' => '<!-- wp:fair-form/fair-form {"formId":"e2e-selector-' . $stamp . '"} /-->',
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create page: ' . $page_id->get_error_message() );
}

echo 'E2E_FAIR_FORM_EVENT_SELECTOR:' . wp_json_encode(
	array(
		'pageId' => (int) $page_id,
		'events' => $events,
	)
) . "\n";
