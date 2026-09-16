<?php
/**
 * Plugin Name: Fair Events E2E Support
 * Description: Test-only helpers loaded ONLY inside the Playwright wp-env
 *              instance (mounted via the `mappings` entry in .wp-env.json).
 *              Never shipped to production and never mounted by the dev
 *              `docker compose` stack.
 *
 * It does five things, all confined to the test environment:
 *
 *   1. Captures outgoing mail into the `fair_e2e_captured_mail` option instead
 *      of sending it, so specs can assert on subject/recipient/body and no real
 *      mail leaves the host.
 *   2. Forces fair-payments-connector into Mollie "test" mode with a fake OAuth
 *      connection, so the production Mollie code path runs without a real
 *      Mollie account. (API key authentication was retired in #1317 — there
 *      is no key-based fallback left to fake.)
 *   3. Pre-declares a fake Mollie HTTP transport (see lib/mollie-http-double.php)
 *      so every Mollie API call returns canned responses. This keeps ALL of the
 *      real fair-payments-connector / fair-audience purchase code in play while making the
 *      "payment" deterministic and offline.
 *   4. Bypasses GetTicketsController's per-IP rate limit, which a full API/E2E
 *      test run exhausts well before it finishes (every spec run shares one
 *      source IP).
 *   5. Pre-declares a fake Meta Conversions API transport (see
 *      lib/meta-http-double.php) so fair-events-experimental's delivery
 *      outbox always talks to a canned "accepted" response instead of the
 *      real graph.facebook.com.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/**
 * Test-only Polylang translation groups. Singleton unless an option maps the
 * post ID to a language => post-ID array.
 *
 * @param int $post_id Post ID.
 * @return array Translation map.
 */
function pll_get_post_translations( $post_id ) {
	$groups = get_option( 'fair_e2e_polylang_groups', array() );
	return isset( $groups[ $post_id ] ) && is_array( $groups[ $post_id ] )
		? $groups[ $post_id ]
		: array( 'current' => (int) $post_id );
}

/**
 * Test-only Polylang term-language stub, backing CategoriesController's
 * multilingual category picker (#1627). Maps a term ID to a language name
 * via the fair_e2e_polylang_term_languages option (set through the
 * fair-e2e/v1/term-languages route below); an unmapped term returns false,
 * matching real Polylang's behaviour for a term with no assigned language.
 *
 * @param int    $term_id Term ID.
 * @param string $field   Language field requested ('name' or 'slug').
 * @return string|false
 */
function pll_get_term_language( $term_id, $field = 'slug' ) {
	$languages = get_option( 'fair_e2e_polylang_term_languages', array() );
	if ( ! isset( $languages[ $term_id ][ $field ] ) ) {
		return false;
	}
	return $languages[ $term_id ][ $field ];
}

// Reproduce Polylang's set_object_terms cleanup for a configured post.
add_action(
	'set_object_terms',
	static function ( $post_id, $terms, $tt_ids, $taxonomy ) {
		$fixture = get_option( 'fair_e2e_category_assignment', array() );
		if ( 'category' !== $taxonomy || (int) ( $fixture['post_id'] ?? 0 ) !== (int) $post_id ) {
			return;
		}
		$allowed = array_map( 'intval', $fixture['allowed_ids'] ?? array() );
		$remove  = array_diff( array_map( 'intval', (array) $terms ), $allowed );
		if ( $remove ) {
			wp_remove_object_terms( $post_id, $remove, 'category' );
		}
	},
	10,
	4
);

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'fair-e2e/v1',
			'/category-assignment',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' ); },
				'callback'            => static function ( WP_REST_Request $request ) {
					update_option(
						'fair_e2e_category_assignment',
						array(
							'post_id'     => absint( $request->get_param( 'post_id' ) ),
							'allowed_ids' => array_map( 'absint', (array) $request->get_param( 'allowed_ids' ) ),
						),
						false
					);
					return rest_ensure_response( array( 'updated' => true ) );
				},
			)
		);
		register_rest_route(
			'fair-e2e/v1',
			'/polylang-groups',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					$groups = $request->get_param( 'groups' );
					update_option( 'fair_e2e_polylang_groups', is_array( $groups ) ? $groups : array(), false );
					if ( $request->has_param( 'enabled_post_types' ) ) {
						$enabled_post_types = $request->get_param( 'enabled_post_types' );
						update_option( 'fair_events_enabled_post_types', is_array( $enabled_post_types ) ? $enabled_post_types : array(), false );
					}

					$saved_post_id = absint( $request->get_param( 'saved_post_id' ) );
					if ( $saved_post_id ) {
						do_action( 'pll_save_post', $saved_post_id );
					}

					return rest_ensure_response( array( 'updated' => true ) );
				},
			)
		);

		register_rest_route(
			'fair-e2e/v1',
			'/term-languages',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					$languages = $request->get_param( 'languages' );
					update_option( 'fair_e2e_polylang_term_languages', is_array( $languages ) ? $languages : array(), false );

					return rest_ensure_response( array( 'updated' => true ) );
				},
			)
		);

		register_rest_route(
			'fair-e2e/v1',
			'/repair-recurrence-status',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					global $wpdb;

					$invalid_id   = absint( $request->get_param( 'invalid_id' ) );
					$cancelled_id = absint( $request->get_param( 'cancelled_id' ) );
					$table_name   = $wpdb->prefix . 'fair_event_dates';

					$wpdb->query(
						$wpdb->prepare(
							'UPDATE %i SET status = %s WHERE id = %d AND occurrence_type = %s',
							$table_name,
							'',
							$invalid_id,
							'generated'
						)
					);
					\FairEvents\Database\Schema::update_db_version( '3.30.0' );
					\FairEvents\Database\Installer::maybe_upgrade();

					return rest_ensure_response(
						array(
							'invalid_id'       => $invalid_id,
							'invalid_status'   => $wpdb->get_var( $wpdb->prepare( 'SELECT status FROM %i WHERE id = %d', $table_name, $invalid_id ) ),
							'cancelled_id'     => $cancelled_id,
							'cancelled_status' => $wpdb->get_var( $wpdb->prepare( 'SELECT status FROM %i WHERE id = %d', $table_name, $cancelled_id ) ),
						)
					);
				},
			)
		);

		register_rest_route(
			'fair-e2e/v1',
			'/mark-signup-over-capacity',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					$updated = \FairEvents\Models\EventSignup::mark_over_capacity(
						absint( $request->get_param( 'signup_id' ) )
					);

					return rest_ensure_response( array( 'updated' => $updated ) );
				},
			)
		);

		// Insert a fair-payments-connector transaction row directly, with a
		// real local event_date_id in its own column (not just metadata) —
		// the shape a genuine ticket purchase produces once paid, which the
		// import/webhook-driven creation paths in this test environment
		// can't reach (see TESTING.md's manual-check note for the Mollie
		// double being e2e-only). Lets fair-finance's reconciliation specs
		// exercise real budget resolution without a live Mollie payment.
		register_rest_route(
			'fair-e2e/v1',
			'/test-transactions',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'permission_callback' => static function () {
						return current_user_can( 'manage_options' );
					},
					'callback'            => static function ( WP_REST_Request $request ) {
						if ( ! class_exists( '\FairPaymentsConnector\Database\Schema' ) ) {
							return new WP_Error(
								'fair_payments_connector_required',
								'fair-payments-connector must be active.',
								array( 'status' => 503 )
							);
						}

						global $wpdb;
						$table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();

						$event_date_id     = $request->get_param( 'event_date_id' );
						$connected_site_id = $request->get_param( 'connected_site_id' );

						// A Connected Site import writes this to metadata, not
						// a real column (see Transaction::import()); mirror
						// that here so fair-finance's Connected Site budget
						// resolution specs can exercise real reconciliation
						// lookups without a live remote import.
						$metadata = $connected_site_id ? wp_json_encode( array( 'connected_site_id' => absint( $connected_site_id ) ) ) : '';

						$inserted = $wpdb->insert(
							$table,
							array(
								'mollie_payment_id' => 'tr_e2e_' . wp_generate_password( 20, false ),
								'event_date_id'     => $event_date_id ? absint( $event_date_id ) : null,
								'amount'            => (float) $request->get_param( 'amount' ),
								'application_fee'   => $request->has_param( 'application_fee' ) ? (float) $request->get_param( 'application_fee' ) : null,
								'mollie_fee'        => $request->has_param( 'mollie_fee' ) ? (float) $request->get_param( 'mollie_fee' ) : null,
								'status'            => $request->get_param( 'status' ) ? sanitize_text_field( $request->get_param( 'status' ) ) : 'paid',
								'testmode'          => 0,
								'description'       => sanitize_text_field( (string) $request->get_param( 'description' ) ),
								'metadata'          => $metadata,
							),
							array( '%s', '%d', '%f', '%f', '%f', '%s', '%d', '%s', '%s' )
						);

						if ( ! $inserted ) {
							return new WP_Error( 'insert_failed', 'Could not insert test transaction.', array( 'status' => 500 ) );
						}

						return rest_ensure_response( array( 'id' => $wpdb->insert_id ) );
					},
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'permission_callback' => static function () {
						return current_user_can( 'manage_options' );
					},
					'callback'            => static function ( WP_REST_Request $request ) {
						global $wpdb;
						$table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();

						$wpdb->delete( $table, array( 'id' => absint( $request->get_param( 'id' ) ) ), array( '%d' ) );

						return rest_ensure_response( array( 'deleted' => true ) );
					},
				),
			)
		);
	}
);

/*
 * 0. Force fair-form's bundled-translations flag from an option, so specs can
 *    exercise the central Fair Event Plugins settings screen's "locked by a
 *    wp-config constant" behavior without restarting PHP between requests —
 *    each request re-reads the option and (re)defines the constant.
 */
if ( get_option( 'fair_e2e_force_form_bundled_translations' ) ) {
	define( 'FAIR_FORM_FEATURE_BUNDLED_TRANSLATIONS', true );
}

/*
 * 1. Intercept the Mollie HTTP transport.
 *
 * Hooks into plugins_loaded (priority 1) — after fair-payments-connector has
 * registered its Composer autoloader (so SDK traits/interfaces are resolvable)
 * but before any REST request triggers new MollieApiClient() (which is the
 * earliest the adapter picker could instantiate the vendored class). Declaring
 * our double at that point is enough to shadow the final class.
 */
\add_action(
	'plugins_loaded',
	static function () {
		require_once __DIR__ . '/lib/mollie-http-double.php';
	},
	1
);

/*
 * 2. Force fair-payments-connector into test mode with a fake OAuth connection.
 *
 * MolliePaymentHandler::is_configured() and its constructor only ever consult
 * the OAuth option set — there is no API-key fallback since #1317 — so the
 * double needs a connected-looking site: a truthy `_connected` flag, a
 * profile ID (used for the payment/method-allowlist calls), a syntactically
 * plausible access token, and an expiry far enough in the future that
 * get_valid_access_token() never calls the real, un-doubled
 * `https://fair-event-plugins.com/oauth/refresh`.
 */
add_filter(
	'pre_option_fair_payment_mollie_connected',
	static function () {
		return true;
	}
);
add_filter(
	'pre_option_fair_payment_mollie_profile_id',
	static function () {
		return 'pfl_e2e0000000';
	}
);
add_filter(
	'pre_option_fair_payment_mollie_access_token',
	static function () {
		return 'access_e2e_' . str_repeat( 'e', 30 );
	}
);
add_filter(
	'pre_option_fair_payment_mollie_token_expires',
	static function () {
		return time() + YEAR_IN_SECONDS;
	}
);
add_filter(
	'pre_option_fair_payment_mode',
	static function () {
		return 'test';
	}
);

/*
 * 3. Bypass GetTicketsController's per-IP rate limit (20 requests/hour in
 *    production). A full test run drives far more than that many real
 *    signups through the public get-tickets endpoint from the CI runner's
 *    single IP, which would otherwise fail later specs with 429s unrelated
 *    to what they're testing. The per-email limit is left untouched — it's
 *    what EventSignupHookBridge.api.spec.js (#1245) exercises directly.
 */
add_filter( 'fair_events_get_tickets_rate_limit_bypass_ip', '__return_true' );

/*
 * 4. Capture mail instead of sending it.
 *
 * Returning a non-null value from `pre_wp_mail` short-circuits wp_mail() (so
 * nothing is dispatched) and becomes its return value. We log each message to
 * an option the specs read via WP-CLI.
 */
add_filter(
	'pre_wp_mail',
	static function ( $short_circuit, $atts ) {
		$log   = get_option( 'fair_e2e_captured_mail', array() );
		$log[] = array(
			'to'      => isset( $atts['to'] ) ? $atts['to'] : '',
			'subject' => isset( $atts['subject'] ) ? $atts['subject'] : '',
			'body'    => isset( $atts['message'] ) ? $atts['message'] : '',
			'headers' => isset( $atts['headers'] ) ? $atts['headers'] : '',
			'time'    => time(),
		);
		update_option( 'fair_e2e_captured_mail', $log, false );

		return true;
	},
	10,
	2
);

/*
 * 5. Intercept the Meta Conversions API transport.
 *
 * Unlike the Mollie double, this doesn't need an early plugins_loaded hook —
 * `pre_http_request` is a plain filter with no SDK class to shadow, so
 * requiring it directly is enough as long as it happens before any request
 * fires (fair-events-experimental's outbox delivery always runs later, on a
 * scheduled hook).
 */
require_once __DIR__ . '/lib/meta-http-double.php';
