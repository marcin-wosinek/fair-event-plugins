<?php
/**
 * Direct links to the Meta App Dashboard pages used in webhook setup.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

defined( 'WPINC' ) || die;

/**
 * Resolves the app that issued the access token and the business that owns
 * the saved WhatsApp Business Account, and builds links to that app's Basic
 * settings and to the WhatsApp use case's webhook configuration.
 *
 * The dashboard routes are Meta's own UI paths, not an API contract, so the
 * written instructions stay usable without them. Each lookup is independent
 * and cached for the token in effect (and the account, for the business);
 * replacing either one, including by an environment override, makes the
 * cached result stop applying. A failure only means a missing link.
 */
class DashboardLinks {
	public const APP_TRANSIENT      = 'fair_events_experimental_whatsapp_app_id';
	public const BUSINESS_TRANSIENT = 'fair_events_experimental_whatsapp_business_id';

	/** Seconds a resolved ID is reused. */
	public const SUCCESS_TTL = DAY_IN_SECONDS;

	/** Seconds a failed lookup is remembered before Meta is asked again. */
	public const FAILURE_TTL = 5 * MINUTE_IN_SECONDS;

	private const DASHBOARD = 'https://developers.facebook.com/apps/';

	/**
	 * Links for the saved configuration, each null when it cannot be built.
	 *
	 * @return array{app_settings_url: string|null, webhook_configuration_url: string|null}
	 */
	public static function resolve() {
		$links = array(
			'app_settings_url'          => null,
			'webhook_configuration_url' => null,
		);
		$token = Connector::token();
		$waba  = Configuration::ids()['waba_id'];
		if ( '' === $token || ! Configuration::valid_id( $waba ) ) {
			return $links;
		}

		$client = new Client( $token );
		$app    = self::cached(
			self::APP_TRANSIENT,
			self::fingerprint( $token ),
			static function () use ( $client ) {
				return $client->app_id();
			}
		);
		if ( '' === $app ) {
			return $links;
		}
		$business = self::cached(
			self::BUSINESS_TRANSIENT,
			self::fingerprint( $token . '|' . $waba ),
			static function () use ( $client, $waba ) {
				return $client->owner_business_id( $waba );
			}
		);

		$links['app_settings_url'] = self::DASHBOARD . $app . '/settings/basic/';
		if ( '' !== $business ) {
			$links['webhook_configuration_url'] = self::DASHBOARD . $app . '/use_cases/customize/wa-settings/?' . http_build_query(
				array(
					'use_case_enum' => 'WHATSAPP_BUSINESS_MESSAGING',
					'product_route' => 'whatsapp-business',
					'business_id'   => $business,
					'selected_tab'  => 'wa-settings',
				),
				'',
				'&',
				PHP_QUERY_RFC3986
			);
		}
		return $links;
	}

	/**
	 * A cached lookup result while it was made for the same inputs, otherwise
	 * a fresh one, cached for a day on success or five minutes on failure.
	 *
	 * @param string   $transient Transient name.
	 * @param string   $key       Fingerprint of the lookup's inputs.
	 * @param callable $lookup    Returns a numeric ID or ''.
	 * @return string Numeric ID, or ''.
	 */
	private static function cached( $transient, $key, callable $lookup ) {
		$stored = get_transient( $transient );
		if ( is_array( $stored ) && hash_equals( $key, (string) ( $stored['key'] ?? '' ) ) ) {
			$id = (string) ( $stored['id'] ?? '' );
			return Configuration::valid_id( $id ) ? $id : '';
		}
		$id = (string) $lookup();
		set_transient(
			$transient,
			array(
				'key' => $key,
				'id'  => $id,
			),
			'' === $id ? self::FAILURE_TTL : self::SUCCESS_TTL
		);
		return $id;
	}

	/**
	 * A salted hash that tells inputs apart without storing the token.
	 *
	 * @param string $value Inputs, including the token.
	 * @return string
	 */
	private static function fingerprint( $value ) {
		return wp_hash( $value, 'auth' );
	}
}
