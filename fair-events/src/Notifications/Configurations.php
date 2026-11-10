<?php
/**
 * Event notification configurations.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Stores every notification configuration: one schedule, event selection and
 * destination of one notification type, under an immutable ID.
 *
 * A site can have several configurations of the same type. Each one is kept
 * in its own option, as are its next scheduled send, run history and last
 * sent week ({@see self::option()}), so saving or sending one never rewrites
 * another. Adding, changing and deleting a configuration run under one lock,
 * so a save never recreates a configuration deleted meanwhile.
 *
 * The configuration that took over a type's former single settings uses the
 * type key as its ID ({@see self::legacy_id()}); the type's original routes
 * keep managing that configuration. Every other ID is a server-generated
 * UUID.
 */
class Configurations {
	public const TELEGRAM         = 'telegram';
	public const BULK_EMAIL       = 'bulk_email';
	public const INDIVIDUAL_EMAIL = 'individual_email';
	public const TYPES            = array( self::TELEGRAM, self::BULK_EMAIL, self::INDIVIDUAL_EMAIL );

	/**
	 * Option listing every configuration's ID and type, in creation order.
	 */
	public const INDEX_OPTION = 'fair_events_notification_configurations';

	/**
	 * Prefix of each configuration's own options.
	 */
	public const OPTION_PREFIX = 'fair_events_notification_config_';

	public const MAX_NAME_LENGTH = 100;
	private const ID_PATTERN     = '/^[a-z0-9_-]{1,36}$/';
	private const LOCK_WAIT      = 5;

	/**
	 * Every configuration, optionally of one type, in creation order.
	 *
	 * @param string|null $type Notification type, or null for all.
	 * @return array[] Records with id, type, name, created_at and settings.
	 */
	public static function all( $type = null ) {
		$records = array();
		foreach ( self::index() as $entry ) {
			if ( null !== $type && $entry['type'] !== $type ) {
				continue;
			}
			$record = self::get( $entry['id'] );
			if ( $record ) {
				$records[] = $record;
			}
		}
		return $records;
	}

	/**
	 * One configuration.
	 *
	 * @param string $id Configuration ID.
	 * @return array|null Record, or null when there is none.
	 */
	public static function get( $id ) {
		if ( ! self::valid_id( $id ) ) {
			return null;
		}
		$record = get_option( self::option( $id ), null );
		if ( ! is_array( $record ) || ! in_array( $record['type'] ?? '', self::TYPES, true ) ) {
			return null;
		}

		return array(
			'id'         => (string) $id,
			'type'       => $record['type'],
			'name'       => (string) ( $record['name'] ?? '' ),
			'created_at' => (string) ( $record['created_at'] ?? '' ),
			'settings'   => is_array( $record['settings'] ?? null ) ? $record['settings'] : array(),
		);
	}

	/**
	 * Whether a configuration exists, optionally of one type.
	 *
	 * @param string      $id   Configuration ID.
	 * @param string|null $type Required type.
	 * @return bool
	 */
	public static function exists( $id, $type = null ) {
		$record = self::get( $id );
		return $record && ( null === $type || $record['type'] === $type );
	}

	/**
	 * A configuration's stored settings, as saved by its type's settings class.
	 *
	 * @param string $id Configuration ID.
	 * @return array Empty when the configuration does not exist.
	 */
	public static function settings( $id ) {
		$record = self::get( $id );
		return $record ? $record['settings'] : array();
	}

	/**
	 * Add a configuration.
	 *
	 * An existing configuration with the requested ID is returned unchanged,
	 * so a repeated migration never overwrites later edits.
	 *
	 * @param string $type     Notification type.
	 * @param string $name     Name shown to administrators; '' shows the type's name.
	 * @param array  $settings Settings, normalized by the type's settings class.
	 * @param string $id       Fixed ID, or '' for a new UUID.
	 * @return array|null The record, or null when it could not be saved.
	 */
	public static function create( $type, $name = '', array $settings = array(), $id = '' ) {
		if ( ! in_array( $type, self::TYPES, true ) ) {
			return null;
		}
		$id = '' === $id ? strtolower( wp_generate_uuid4() ) : $id;
		if ( ! self::valid_id( $id ) ) {
			return null;
		}

		if ( ! Lock::acquire( Lock::CONFIGURATIONS, self::LOCK_WAIT ) ) {
			return null;
		}
		try {
			$existing = self::get( $id );
			if ( $existing ) {
				self::add_to_index( $existing['id'], $existing['type'] );
				return $existing;
			}

			add_option(
				self::option( $id ),
				array(
					'type'       => $type,
					'name'       => self::sanitize_name( $name ),
					'created_at' => current_time( 'mysql', true ),
					'settings'   => $settings,
				),
				'',
				false
			);
			$record = self::get( $id );
			if ( $record ) {
				self::add_to_index( $id, $type );
			}
			return $record;
		} finally {
			Lock::release( Lock::CONFIGURATIONS );
		}
	}

	/**
	 * Change a configuration's name or settings. Its ID and type never change.
	 *
	 * Runs under the configurations lock and re-reads the stored record, so a
	 * save that races a deletion never brings the deleted configuration back.
	 *
	 * @param string $id      Configuration ID.
	 * @param array  $changes 'name' and/or 'settings'.
	 * @return bool Whether the change was saved: false when the configuration
	 *              does not exist or the lock could not be taken.
	 */
	public static function update( $id, array $changes ) {
		if ( ! self::valid_id( $id ) ) {
			return false;
		}
		if ( ! Lock::acquire( Lock::CONFIGURATIONS, self::LOCK_WAIT ) ) {
			return false;
		}
		try {
			self::forget_cached( $id );
			$stored = get_option( self::option( $id ), null );
			if ( ! is_array( $stored ) ) {
				return false;
			}
			if ( array_key_exists( 'name', $changes ) ) {
				$stored['name'] = self::sanitize_name( $changes['name'] );
			}
			if ( array_key_exists( 'settings', $changes ) ) {
				$stored['settings'] = (array) $changes['settings'];
			}
			update_option( self::option( $id ), $stored, false );
			return true;
		} finally {
			Lock::release( Lock::CONFIGURATIONS );
		}
	}

	/**
	 * Remove a configuration and its entry in the list.
	 *
	 * Only the configuration itself goes. Its queued sends are cleared by its
	 * type's dispatcher; its execution and delivery history, delivery claims
	 * and the migration and ownership markers stay, so the audit trail is kept
	 * and a migrated configuration is never created again.
	 *
	 * @param string $id Configuration ID.
	 * @return array|false|null The deleted record, false when there was none,
	 *                          or null when the lock could not be taken.
	 */
	public static function delete( $id ) {
		if ( ! self::valid_id( $id ) ) {
			return false;
		}
		if ( ! Lock::acquire( Lock::CONFIGURATIONS, self::LOCK_WAIT ) ) {
			return null;
		}
		try {
			self::forget_cached( $id );
			$record = self::get( $id );
			if ( $record ) {
				delete_option( self::option( $id ) );
			}
			self::remove_from_index( $id );
			return $record ? $record : false;
		} finally {
			Lock::release( Lock::CONFIGURATIONS );
		}
	}

	/**
	 * Whether a configuration exists, read past this request's option cache.
	 *
	 * For code that has just scheduled a send and must not leave one queued
	 * for a configuration another request deleted meanwhile.
	 *
	 * @param string $id   Configuration ID.
	 * @param string $type Required type.
	 * @return bool
	 */
	public static function still_exists( $id, $type ) {
		if ( ! self::valid_id( $id ) ) {
			return false;
		}
		self::forget_cached( $id );
		return self::exists( $id, $type );
	}

	/**
	 * Name of a configuration's option, or of one of its state options.
	 *
	 * @param string $id     Configuration ID.
	 * @param string $suffix '' for the configuration itself, or e.g. 'next_run', 'runs', 'last_sent_week'.
	 * @return string
	 */
	public static function option( $id, $suffix = '' ) {
		return self::OPTION_PREFIX . $id . ( '' === $suffix ? '' : '_' . $suffix );
	}

	/**
	 * ID of the configuration that took over a type's former single settings.
	 *
	 * @param string $type Notification type.
	 * @return string
	 */
	public static function legacy_id( $type ) {
		return $type;
	}

	/**
	 * Whether a value can be a configuration ID.
	 *
	 * @param mixed $id Value.
	 * @return bool
	 */
	public static function valid_id( $id ) {
		return is_string( $id ) && (bool) preg_match( self::ID_PATTERN, $id );
	}

	/**
	 * A name as stored: plain text, trimmed and shortened.
	 *
	 * @param mixed $name Raw name.
	 * @return string
	 */
	public static function sanitize_name( $name ) {
		return mb_substr( trim( sanitize_text_field( (string) $name ) ), 0, self::MAX_NAME_LENGTH );
	}

	/**
	 * Listed IDs and types.
	 *
	 * @return array[]
	 */
	private static function index() {
		$index = get_option( self::INDEX_OPTION, array() );
		return is_array( $index )
			? array_values(
				array_filter(
					$index,
					static function ( $entry ) {
						return is_array( $entry ) && self::valid_id( $entry['id'] ?? null ) && in_array( $entry['type'] ?? '', self::TYPES, true );
					}
				)
			)
			: array();
	}

	/**
	 * Drop a configuration's option and the list from this request's cache,
	 * so the next read sees what another request stored.
	 *
	 * @param string $id Configuration ID.
	 * @return void
	 */
	private static function forget_cached( $id ) {
		wp_cache_delete( self::option( $id ), 'options' );
		wp_cache_delete( self::INDEX_OPTION, 'options' );
		wp_cache_delete( 'alloptions', 'options' );
		wp_cache_delete( 'notoptions', 'options' );
	}

	/**
	 * Unlist a configuration. Call while holding the lock.
	 *
	 * @param string $id Configuration ID.
	 * @return void
	 */
	private static function remove_from_index( $id ) {
		$index = self::index();
		$kept  = array_values(
			array_filter(
				$index,
				static function ( $entry ) use ( $id ) {
					return $entry['id'] !== $id;
				}
			)
		);
		if ( count( $kept ) !== count( $index ) ) {
			update_option( self::INDEX_OPTION, $kept, true );
		}
	}

	/**
	 * List a configuration, once. Call while holding the lock.
	 *
	 * @param string $id   Configuration ID.
	 * @param string $type Notification type.
	 * @return void
	 */
	private static function add_to_index( $id, $type ) {
		// Another request may have added one while this one waited.
		wp_cache_delete( self::INDEX_OPTION, 'options' );
		wp_cache_delete( 'alloptions', 'options' );

		$index = self::index();
		foreach ( $index as $entry ) {
			if ( $entry['id'] === $id ) {
				return;
			}
		}
		$index[] = array(
			'id'   => $id,
			'type' => $type,
		);
		update_option( self::INDEX_OPTION, $index, true );
	}
}
