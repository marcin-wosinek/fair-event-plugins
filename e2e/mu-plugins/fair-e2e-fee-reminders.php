<?php
/**
 * Plugin Name: Fair Audience E2E Fee Reminders
 * Description: Test-only routes for the membership fee reminder specs, loaded
 *              ONLY inside the Playwright wp-env instance. Reads and clears
 *              the mail captured by fair-e2e-support.php, makes delivery to
 *              one address fail, and stores a raw participant email that the
 *              participant routes would sanitize away.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

// Fail delivery to the address configured through fair-e2e/v1/fee-reminders/mail-failure.
// Runs after the capture filter in fair-e2e-support.php, so wp_mail() reports
// the failure while still sending nothing.
add_filter(
	'pre_wp_mail',
	static function ( $short_circuit, $atts ) {
		$failing = (string) get_option( 'fair_e2e_fail_mail_to', '' );
		if ( '' === $failing ) {
			return $short_circuit;
		}

		return in_array( $failing, (array) ( $atts['to'] ?? array() ), true ) ? false : $short_circuit;
	},
	20,
	2
);

add_action(
	'rest_api_init',
	static function () {
		$admin_only = static function () {
			return current_user_can( 'manage_options' );
		};

		// Mail captured for one address (recipient and subject only), or
		// cleared entirely so a spec starts from an empty log.
		register_rest_route(
			'fair-e2e/v1',
			'/fee-reminders/mail',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function ( WP_REST_Request $request ) {
						$email = sanitize_email( (string) $request->get_param( 'to' ) );
						$found = array();
						foreach ( get_option( 'fair_e2e_captured_mail', array() ) as $entry ) {
							$to = (array) ( $entry['to'] ?? array() );
							if ( '' !== $email && ! in_array( $email, $to, true ) ) {
								continue;
							}
							$found[] = array(
								'to'      => $to,
								'subject' => (string) ( $entry['subject'] ?? '' ),
							);
						}

						return rest_ensure_response( $found );
					},
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => $admin_only,
					'callback'            => static function () {
						delete_option( 'fair_e2e_captured_mail' );

						return rest_ensure_response( array( 'cleared' => true ) );
					},
				),
			)
		);

		// Make wp_mail() fail for one recipient (an empty address clears it).
		register_rest_route(
			'fair-e2e/v1',
			'/fee-reminders/mail-failure',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					$email = sanitize_email( (string) $request->get_param( 'email' ) );
					if ( '' === $email ) {
						delete_option( 'fair_e2e_fail_mail_to' );
					} else {
						update_option( 'fair_e2e_fail_mail_to', $email, false );
					}

					return rest_ensure_response( array( 'failing' => $email ) );
				},
			)
		);

		// Store a participant email exactly as given, the way imported or
		// legacy data can hold an address the participant routes reject.
		register_rest_route(
			'fair-e2e/v1',
			'/fee-reminders/participant-email',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => $admin_only,
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test-only fixture write.
					$updated = $wpdb->update(
						$wpdb->prefix . 'fair_audience_participants',
						array( 'email' => (string) $request->get_param( 'email' ) ),
						array( 'id' => absint( $request->get_param( 'participant_id' ) ) ),
						array( '%s' ),
						array( '%d' )
					);

					return rest_ensure_response( array( 'updated' => (int) $updated ) );
				},
			)
		);
	}
);
