<?php
/**
 * Raw source states for the campaign facts API spec (#2420): rows the REST
 * API refuses to write (blank venue fields, partial or invalid coordinates,
 * a legacy null attendance mode, broken references) and the site timezone.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/campaign-facts.php <action> '<json>'
 *
 * Actions:
 *   venue          {columns}             Insert a venue row; returns its id.
 *   delete-venue   {id}                  Delete a venue row.
 *   event-date     {id, columns}         Update raw event-date columns.
 *   link           {event_date_id, post_id} Insert a junction link row.
 *   unlink         {event_date_id, post_id} Delete a junction link row.
 *   timezone       {timezone_string, gmt_offset} Set the site timezone; returns the previous one.
 *
 * Prints a single `E2E_CAMPAIGN_FACTS:{json}` line.
 *
 * @package FairEventsE2E
 */

// phpcs:disable WordPress.DB.DirectDatabaseQuery

global $wpdb;

$cf_action = isset( $args[0] ) ? (string) $args[0] : '';
$cf_data   = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
$cf_data   = is_array( $cf_data ) ? $cf_data : array();
$cf_result = array();

switch ( $cf_action ) {
	case 'venue':
		$cf_columns = array_merge(
			array(
				'name'       => 'Campaign facts venue',
				'created_at' => current_time( 'mysql' ),
				'updated_at' => current_time( 'mysql' ),
			),
			(array) ( $cf_data['columns'] ?? array() )
		);
		if ( false === $wpdb->insert( $wpdb->prefix . 'fair_event_venues', $cf_columns ) ) {
			WP_CLI::error( 'Venue insert failed: ' . $wpdb->last_error );
		}
		$cf_result['id'] = (int) $wpdb->insert_id;
		break;

	case 'delete-venue':
		$wpdb->delete( $wpdb->prefix . 'fair_event_venues', array( 'id' => (int) $cf_data['id'] ) );
		break;

	case 'event-date':
		if ( false === $wpdb->update( $wpdb->prefix . 'fair_event_dates', (array) $cf_data['columns'], array( 'id' => (int) $cf_data['id'] ) ) ) {
			WP_CLI::error( 'Event date update failed: ' . $wpdb->last_error );
		}
		break;

	case 'link':
		$wpdb->insert(
			$wpdb->prefix . 'fair_event_date_posts',
			array(
				'event_date_id' => (int) $cf_data['event_date_id'],
				'post_id'       => (int) $cf_data['post_id'],
			)
		);
		break;

	case 'unlink':
		$wpdb->delete(
			$wpdb->prefix . 'fair_event_date_posts',
			array(
				'event_date_id' => (int) $cf_data['event_date_id'],
				'post_id'       => (int) $cf_data['post_id'],
			)
		);
		break;

	case 'timezone':
		$cf_result = array(
			'timezone_string' => get_option( 'timezone_string' ),
			'gmt_offset'      => get_option( 'gmt_offset' ),
		);
		update_option( 'timezone_string', (string) $cf_data['timezone_string'] );
		update_option( 'gmt_offset', $cf_data['gmt_offset'] );
		$cf_result['now'] = wp_timezone_string();
		break;

	default:
		WP_CLI::error( "Unknown action: {$cf_action}" );
}

echo 'E2E_CAMPAIGN_FACTS:' . wp_json_encode( (object) $cf_result ) . "\n";
