<?php
/**
 * Fresh-install sites for the Statistics coverage of #2112.
 *
 * The `wp-content/db.php` test drop-in (e2e/drop-ins/db.php) gives each
 * name in FAIR_E2E_FRESH_SITES its own table prefix, so a site installed
 * there has never seen Fair Audience or Fair Payments Connector unless the
 * spec activates them. e2e/support/fresh-site.js drives these actions.
 *
 * Usage: wp eval-file .../fresh-install.php <action> <json>
 *
 * Actions (run on the default site):
 *   drop   {site}  Drop every table of that fresh site. Only prefixes listed
 *                  in FAIR_E2E_FRESH_SITES qualify, and never the running
 *                  site's own prefix.
 *
 * Actions (run on the fresh site, FAIR_E2E_SITE=<site>):
 *   state  {}      The table prefix, the active plugins, the Fair Audience
 *                  and Fair Payments Connector tables and options found (a
 *                  never-activated plugin has none), and the Statistics
 *                  reader activation.
 *   seed   {eventDateId, ticketTypeId, eventCapacity?, ticketCapacity?,
 *           activities?: [{name, capacity?}],
 *           purchases?: [{quantity, createdAt ('Y-m-d H:i:s', site-local),
 *                         activities?: [index into activities, per unit],
 *                         paid? (amount)}]}
 *                  Confirmed purchases with their ticket units and activity
 *                  selections, written with Fair Events' own tables only. A
 *                  `paid` purchase also gets a paid Connector transaction and
 *                  its charge link when Connector's table exists, and stays
 *                  unpaid otherwise.
 *
 * Prints one `E2E_FRESH_INSTALL:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.SchemaChange -- Test fixture writes exact rows and drops test-only tables.
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\SignupPaymentLink;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$tables_like = static function ( $prefix ) use ( $wpdb ) {
	return $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $prefix ) . '%' ) );
};
$result      = array();

switch ( $fixture_action ) {
	case 'drop':
		$site = (string) ( $data['site'] ?? '' );
		if ( ! defined( 'FAIR_E2E_FRESH_SITES' ) || ! isset( FAIR_E2E_FRESH_SITES[ $site ] ) ) {
			WP_CLI::error( "Unknown fresh site: {$site}" );
		}
		$prefix = FAIR_E2E_FRESH_SITES[ $site ];
		// The fresh prefixes never overlap the default one; refuse anything
		// that could match the running site's tables.
		if ( 0 !== strpos( $prefix, 'e2efresh_' ) || 0 === strpos( $wpdb->prefix, $prefix ) || 0 === strpos( $prefix, $wpdb->prefix ) ) {
			WP_CLI::error( "Refusing to drop tables with prefix {$prefix} from site {$wpdb->prefix}." );
		}
		$dropped = array();
		foreach ( $tables_like( $prefix ) as $table ) {
			if ( 0 !== strpos( $table, $prefix ) ) {
				continue;
			}
			$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $table ) );
			$dropped[] = $table;
		}
		$result = array(
			'prefix'  => $prefix,
			'dropped' => count( $dropped ),
		);
		break;

	case 'state':
		$option_names = static function ( $like ) use ( $wpdb ) {
			return $wpdb->get_col( $wpdb->prepare( 'SELECT option_name FROM %i WHERE option_name LIKE %s', $wpdb->options, $wpdb->esc_like( $like ) . '%' ) );
		};
		$result       = array(
			'prefix'           => $wpdb->prefix,
			'activePlugins'    => array_values( (array) get_option( 'active_plugins', array() ) ),
			'audienceTables'   => $tables_like( $wpdb->prefix . 'fair_audience' ),
			'audienceOptions'  => $option_names( 'fair_audience' ),
			'connectorTables'  => $tables_like( $wpdb->prefix . 'fair_payment' ),
			'connectorOptions' => $option_names( 'fair_payment' ),
		);
		break;

	case 'seed':
		$event_date_id = (int) $data['eventDateId'];
		$ticket_type   = (int) $data['ticketTypeId'];
		$transactions  = $wpdb->prefix . 'fair_payment_transactions';
		$has_connector = in_array( $transactions, $tables_like( $transactions ), true );

		if ( array_key_exists( 'eventCapacity', $data ) ) {
			$wpdb->update( $wpdb->prefix . 'fair_event_dates', array( 'capacity' => $data['eventCapacity'] ), array( 'id' => $event_date_id ) );
		}
		if ( array_key_exists( 'ticketCapacity', $data ) ) {
			$wpdb->update( $wpdb->prefix . 'fair_events_ticket_types', array( 'capacity' => $data['ticketCapacity'] ), array( 'id' => $ticket_type ) );
		}

		$activities = array();
		foreach ( array_values( $data['activities'] ?? array() ) as $index => $activity ) {
			$wpdb->insert(
				$wpdb->prefix . 'fair_events_ticket_options',
				array(
					'event_date_id' => $event_date_id,
					'name'          => (string) $activity['name'],
					'capacity'      => isset( $activity['capacity'] ) ? (int) $activity['capacity'] : null,
					'sort_order'    => $index,
				)
			);
			$activities[] = array(
				'id'   => (int) $wpdb->insert_id,
				'name' => (string) $activity['name'],
			);
		}

		$signup_ids      = array();
		$transaction_ids = array();
		foreach ( array_values( $data['purchases'] ?? array() ) as $purchase ) {
			$quantity   = (int) $purchase['quantity'];
			$created_at = (string) $purchase['createdAt'];
			$wpdb->insert(
				$wpdb->prefix . 'fair_events_signups',
				array(
					'event_date_id'  => $event_date_id,
					'ticket_type_id' => $ticket_type,
					'name'           => 'Fresh install buyer',
					'email'          => 'fresh-install-buyer@example.test',
					'quantity'       => $quantity,
					'status'         => 'confirmed',
					'created_at'     => $created_at,
				)
			);
			$signup_id    = (int) $wpdb->insert_id;
			$signup_ids[] = $signup_id;

			for ( $unit = 0; $unit < $quantity; $unit++ ) {
				$wpdb->insert(
					$wpdb->prefix . 'fair_events_tickets',
					array(
						'reference'      => md5( wp_generate_uuid4() ),
						'signup_id'      => $signup_id,
						'unit_position'  => $unit + 1,
						'event_date_id'  => $event_date_id,
						'ticket_type_id' => $ticket_type,
						'status'         => 'confirmed',
					)
				);
				$ticket_id = (int) $wpdb->insert_id;
				$selected  = $purchase['activities'][ $unit ] ?? null;
				if ( null !== $selected && isset( $activities[ (int) $selected ] ) ) {
					$wpdb->insert(
						$wpdb->prefix . 'fair_events_ticket_activities',
						array(
							'ticket_id'          => $ticket_id,
							'ticket_option_id'   => $activities[ (int) $selected ]['id'],
							'ticket_option_name' => $activities[ (int) $selected ]['name'],
							'status'             => 'confirmed',
						)
					);
				}
			}

			if ( isset( $purchase['paid'] ) && $has_connector ) {
				$wpdb->insert(
					$transactions,
					array(
						'mollie_payment_id' => 'tr_fresh_' . wp_generate_uuid4(),
						'amount'            => (float) $purchase['paid'],
						'currency'          => 'EUR',
						'status'            => 'paid',
						'description'       => 'Fresh install fixture',
						'created_at'        => $created_at,
					)
				);
				$transaction_id    = (int) $wpdb->insert_id;
				$transaction_ids[] = $transaction_id;
				$wpdb->insert(
					SignupPaymentLink::table(),
					array(
						'signup_id'        => $signup_id,
						'transaction_id'   => $transaction_id,
						'role'             => SignupPaymentLink::ROLE_CHARGE,
						'allocated_amount' => (float) $purchase['paid'],
						'currency'         => 'EUR',
						'attribution'      => SignupPaymentLink::ATTRIBUTION_LIVE,
						'evidence'         => wp_json_encode( array( 'type' => 'e2e' ) ),
						'created_at'       => $created_at,
						'recorded_at'      => gmdate( 'Y-m-d H:i:s' ),
					)
				);
				$wpdb->update( $wpdb->prefix . 'fair_events_signups', array( 'transaction_id' => $transaction_id ), array( 'id' => $signup_id ) );
			}
		}

		$result = array(
			'activityIds'    => array_column( $activities, 'id' ),
			'signupIds'      => $signup_ids,
			'transactionIds' => $transaction_ids,
		);
		break;

	default:
		WP_CLI::error( "Unknown action: {$fixture_action}" );
}

echo 'E2E_FRESH_INSTALL:' . wp_json_encode( (object) $result ) . "\n";
