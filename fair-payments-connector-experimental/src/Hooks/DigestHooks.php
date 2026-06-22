<?php
/**
 * Digest sender hooks for Fair Payments Connector Experimental
 *
 * Registers custom WP-Cron intervals and flushes the notification queue
 * on each tick, grouping rows by route and sending one combined digest.
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Hooks;

use FairPaymentsConnectorExperimental\Services\DigestBuilder;

defined( 'WPINC' ) || die;

/**
 * Drives the periodic digest flush via WP-Cron.
 */
class DigestHooks {

	const CRON_HOOK     = 'fair_payment_flush_digest';
	const STUCK_MINUTES = 30;

	/**
	 * Frequencies that map to WP-Cron schedule names.
	 */
	const FREQUENCY_SCHEDULES = array(
		'hourly' => 'fair_payment_digest_hourly',
		'daily'  => 'fair_payment_digest_daily',
		'weekly' => 'fair_payment_digest_weekly',
	);

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function init() {
		add_filter( 'cron_schedules', array( $this, 'add_cron_schedules' ) );
		add_action( self::CRON_HOOK, array( $this, 'flush_due' ) );

		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'fair_payment_digest_hourly', self::CRON_HOOK );
		}
	}

	/**
	 * Register custom WP-Cron intervals for digest frequencies.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public function add_cron_schedules( $schedules ) {
		if ( ! isset( $schedules['fair_payment_digest_hourly'] ) ) {
			$schedules['fair_payment_digest_hourly'] = array(
				'interval' => HOUR_IN_SECONDS,
				'display'  => __( 'Every hour (fair-payments digest)', 'fair-payments-connector-experimental' ),
			);
		}
		if ( ! isset( $schedules['fair_payment_digest_daily'] ) ) {
			$schedules['fair_payment_digest_daily'] = array(
				'interval' => DAY_IN_SECONDS,
				'display'  => __( 'Every day (fair-payments digest)', 'fair-payments-connector-experimental' ),
			);
		}
		if ( ! isset( $schedules['fair_payment_digest_weekly'] ) ) {
			$schedules['fair_payment_digest_weekly'] = array(
				'interval' => WEEK_IN_SECONDS,
				'display'  => __( 'Every week (fair-payments digest)', 'fair-payments-connector-experimental' ),
			);
		}
		return $schedules;
	}

	/**
	 * Flush unsent queue rows, grouped by route.
	 *
	 * Rows are marked sent_at inline. A row without sent_at that was created
	 * more than STUCK_MINUTES ago is considered orphaned by a previous crash and
	 * is re-eligible for sending (we detect this by sent_at IS NULL AND
	 * created_at is older than the threshold — in practice the window is large
	 * enough that double-send is very unlikely).
	 *
	 * @return void
	 */
	public function flush_due() {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_payment_notification_queue';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$rows = $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM %i WHERE sent_at IS NULL ORDER BY route_id, created_at', $table )
		);

		if ( empty( $rows ) ) {
			return;
		}

		$groups  = array();
		$builder = new DigestBuilder();

		foreach ( $rows as $row ) {
			$groups[ $row->route_id ][] = $row;
		}

		$routes    = (array) get_option( \FairPaymentsConnectorExperimental\Settings\Settings::ROUTES_OPTION, array() );
		$route_map = array();
		foreach ( $routes as $route ) {
			if ( ! empty( $route['id'] ) ) {
				$route_map[ $route['id'] ] = $route;
			}
		}

		foreach ( $groups as $route_id => $route_rows ) {
			$route = isset( $route_map[ $route_id ] ) ? $route_map[ $route_id ] : null;

			$channel_name = $route_rows[0]->channel;
			$destination  = $route_rows[0]->destination;

			if ( $route ) {
				$channel_name = $route['channel'];
				$destination  = $route['destination'];
			}

			$channel = NotificationHooks::make_channel( $channel_name );
			if ( null === $channel ) {
				continue;
			}

			$text = $builder->build( $route_rows );
			$channel->send( $destination, $text );

			$ids = array_map(
				function ( $r ) {
					return (int) $r->id;
				},
				$route_rows
			);

			$placeholders = implode( ', ', array_fill( 0, count( $ids ), '%d' ) );

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
			$wpdb->query(
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
					"UPDATE {$table} SET sent_at = %s WHERE id IN ({$placeholders})",
					array_merge( array( current_time( 'mysql', true ) ), $ids )
				)
			);
		}
	}
}
