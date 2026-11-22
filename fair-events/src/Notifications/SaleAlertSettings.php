<?php
/**
 * Telegram ticket sale alert preferences.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Stores whether Telegram ticket sale alerts are on (#2448), and each
 * organizer's switch and private chat or channel.
 *
 * Organizers are keyed like the sales summaries
 * ({@see SalesSummarySettings::DEFAULT_ORGANIZER} for the sitewide
 * organizer, a UUID for an additional one). Preferences live in their own
 * non-autoloaded option, never in an organizer's identity record, so
 * turning organizer management off or replacing an organizer keeps them.
 *
 * Everything starts off, on new and existing sites alike: nothing is sent
 * until an administrator turns the alerts on and gives an organizer a
 * destination.
 */
class SaleAlertSettings {
	public const OPTION = 'fair_events_sale_alerts';

	/**
	 * Settings that were never saved.
	 *
	 * @return array{enabled: bool, organizers: array<string, array{enabled: bool, chat_id: string}>}
	 */
	public static function defaults() {
		return array(
			'enabled'    => false,
			'organizers' => array(),
		);
	}

	/**
	 * One organizer's settings that were never saved.
	 *
	 * @return array{enabled: bool, chat_id: string}
	 */
	public static function organizer_defaults() {
		return array(
			'enabled' => false,
			'chat_id' => '',
		);
	}

	/**
	 * Whether a key names an organizer: the sitewide one or a UUID.
	 *
	 * @param mixed $key Candidate key.
	 * @return bool
	 */
	public static function valid_key( $key ) {
		return SalesSummarySettings::valid_key( $key ) && SalesSummarySettings::CENTRAL !== $key;
	}

	/**
	 * The saved settings.
	 *
	 * @return array
	 */
	public static function get() {
		return self::sanitize( get_option( self::OPTION, array() ) );
	}

	/**
	 * Whether ticket sale alerts are on at all.
	 *
	 * @return bool
	 */
	public static function enabled() {
		return self::get()['enabled'];
	}

	/**
	 * One organizer's settings; the defaults when never saved.
	 *
	 * @param string $key Organizer key.
	 * @return array{enabled: bool, chat_id: string}
	 */
	public static function organizer( $key ) {
		return self::get()['organizers'][ (string) $key ] ?? self::organizer_defaults();
	}

	/**
	 * Save validated settings. Organizers not named keep their saved
	 * settings, so an organizer hidden while organizer management is off
	 * keeps its destination.
	 *
	 * @param array $settings Validated settings.
	 * @return array The saved settings.
	 */
	public static function save( array $settings ) {
		$current   = self::get();
		$merged    = array(
			'enabled'    => ! empty( $settings['enabled'] ),
			'organizers' => array_merge( $current['organizers'], $settings['organizers'] ?? array() ),
		);
		$sanitized = self::sanitize( $merged );

		if ( false === get_option( self::OPTION, false ) ) {
			add_option( self::OPTION, $sanitized, '', false );
		} else {
			update_option( self::OPTION, $sanitized, false );
		}

		return $sanitized;
	}

	/**
	 * Validate settings from input. Nothing is repaired: a value that isn't
	 * valid is reported by field.
	 *
	 * @param array $value Raw settings: enabled, organizers keyed by organizer.
	 * @return array{settings: array, errors: array<string, string>}
	 */
	public static function validate( array $value ) {
		$errors  = array();
		$enabled = $value['enabled'] ?? false;
		if ( ! is_bool( $enabled ) ) {
			$errors['enabled'] = __( 'Turn ticket sale alerts on or off.', 'fair-events' );
			$enabled           = false;
		}

		$organizers = array();
		$raw        = $value['organizers'] ?? array();
		if ( ! is_array( $raw ) ) {
			$errors['organizers'] = __( 'The organizer settings could not be read.', 'fair-events' );
			$raw                  = array();
		}

		foreach ( $raw as $key => $organizer ) {
			$key = (string) $key;
			if ( ! self::valid_key( $key ) || ! is_array( $organizer ) ) {
				$errors['organizers'] = __( 'The organizer settings could not be read.', 'fair-events' );
				continue;
			}

			$organizer_enabled = $organizer['enabled'] ?? false;
			if ( ! is_bool( $organizer_enabled ) ) {
				$errors[ "organizers.{$key}.enabled" ] = __( 'Turn the organizer’s alerts on or off.', 'fair-events' );
				$organizer_enabled                     = false;
			}

			$chat_id = $organizer['chat_id'] ?? '';
			$chat_id = is_string( $chat_id ) ? trim( $chat_id ) : null;
			if ( null === $chat_id || ( '' !== $chat_id && ! TelegramSettings::valid_chat_id( $chat_id ) ) ) {
				$errors[ "organizers.{$key}.chat_id" ] = __( 'Enter one chat ID (a number such as -1001234567890) or a public @channelname.', 'fair-events' );
				$chat_id                               = '';
			} elseif ( '' === $chat_id && $organizer_enabled ) {
				$errors[ "organizers.{$key}.chat_id" ] = __( 'Enter a chat or channel before turning the organizer’s alerts on.', 'fair-events' );
			}

			$organizers[ $key ] = array(
				'enabled' => $organizer_enabled,
				'chat_id' => $chat_id,
			);
		}

		return array(
			'settings' => array(
				'enabled'    => $enabled,
				'organizers' => $organizers,
			),
			'errors'   => $errors,
		);
	}

	/**
	 * Normalize stored settings onto the defaults. An organizer whose
	 * destination can't be read is stored off.
	 *
	 * @param mixed $value Raw settings.
	 * @return array
	 */
	public static function sanitize( $value ) {
		$defaults = self::defaults();
		if ( ! is_array( $value ) ) {
			return $defaults;
		}

		$organizers = array();
		foreach ( (array) ( $value['organizers'] ?? array() ) as $key => $organizer ) {
			$key = (string) $key;
			if ( ! self::valid_key( $key ) || ! is_array( $organizer ) ) {
				continue;
			}
			$chat_id            = isset( $organizer['chat_id'] ) && is_string( $organizer['chat_id'] ) && TelegramSettings::valid_chat_id( $organizer['chat_id'] ) ? $organizer['chat_id'] : '';
			$organizers[ $key ] = array(
				'enabled' => '' !== $chat_id && true === ( $organizer['enabled'] ?? false ),
				'chat_id' => $chat_id,
			);
		}

		return array(
			'enabled'    => true === ( $value['enabled'] ?? false ),
			'organizers' => $organizers,
		);
	}
}
