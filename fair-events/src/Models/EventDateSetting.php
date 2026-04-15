<?php
/**
 * Event Date Setting model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Event Date Setting model class
 *
 * Stores per-event-date settings as key/value pairs.
 * Only non-default values need to be stored.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventDateSetting {

	/**
	 * Setting ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Event date ID
	 *
	 * @var int
	 */
	public $event_date_id;

	/**
	 * Setting key
	 *
	 * @var string
	 */
	public $setting_key;

	/**
	 * Setting value
	 *
	 * @var string
	 */
	public $setting_value;

	/**
	 * Created at timestamp
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated at timestamp
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Default values for all settings.
	 * Settings at their default value do not need a DB row.
	 */
	const DEFAULTS = array(
		'continues_pricing_period'          => '1',
		'unlimited_tickets_in_price_period' => '1',
		'show_ticket_type_capacity'         => '0',
		'multiple_pricing_periods'          => '0',
	);

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_event_date_settings';
	}

	/**
	 * Get a single setting value for an event date
	 *
	 * @param int    $event_date_id Event date ID.
	 * @param string $key           Setting key.
	 * @return string Setting value (returns default if no row exists).
	 */
	public static function get( $event_date_id, $key ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$value = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT setting_value FROM %i WHERE event_date_id = %d AND setting_key = %s LIMIT 1',
				$table_name,
				$event_date_id,
				$key
			)
		);

		if ( null === $value ) {
			return self::DEFAULTS[ $key ] ?? null;
		}

		return $value;
	}

	/**
	 * Get all settings for an event date, merged with defaults
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Associative array of setting_key => setting_value.
	 */
	public static function get_all_for_event_date( $event_date_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT setting_key, setting_value FROM %i WHERE event_date_id = %d',
				$table_name,
				$event_date_id
			)
		);

		$settings = self::DEFAULTS;

		if ( $results ) {
			foreach ( $results as $row ) {
				$settings[ $row->setting_key ] = $row->setting_value;
			}
		}

		return $settings;
	}

	/**
	 * Set a setting value for an event date
	 *
	 * If the value matches the default, the row is deleted instead.
	 *
	 * @param int    $event_date_id Event date ID.
	 * @param string $key           Setting key.
	 * @param string $value         Setting value.
	 * @return bool True on success.
	 */
	public static function set( $event_date_id, $key, $value ) {
		$default = self::DEFAULTS[ $key ] ?? null;

		if ( $value === $default ) {
			return self::delete_setting( $event_date_id, $key );
		}

		global $wpdb;

		$table_name = self::get_table_name();

		$existing = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT id FROM %i WHERE event_date_id = %d AND setting_key = %s LIMIT 1',
				$table_name,
				$event_date_id,
				$key
			)
		);

		if ( $existing ) {
			$result = $wpdb->update(
				$table_name,
				array( 'setting_value' => $value ),
				array(
					'event_date_id' => $event_date_id,
					'setting_key'   => $key,
				),
				array( '%s' ),
				array( '%d', '%s' )
			);
		} else {
			$result = $wpdb->insert(
				$table_name,
				array(
					'event_date_id' => $event_date_id,
					'setting_key'   => $key,
					'setting_value' => $value,
				),
				array( '%d', '%s', '%s' )
			);
		}

		return false !== $result;
	}

	/**
	 * Save multiple settings for an event date
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $settings      Associative array of key => value.
	 * @return void
	 */
	public static function set_multiple( $event_date_id, $settings ) {
		foreach ( $settings as $key => $value ) {
			if ( ! array_key_exists( $key, self::DEFAULTS ) ) {
				continue;
			}
			self::set( $event_date_id, $key, $value );
		}
	}

	/**
	 * Delete a single setting for an event date
	 *
	 * @param int    $event_date_id Event date ID.
	 * @param string $key           Setting key.
	 * @return bool True on success.
	 */
	public static function delete_setting( $event_date_id, $key ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array(
				'event_date_id' => $event_date_id,
				'setting_key'   => $key,
			),
			array( '%d', '%s' )
		);

		return false !== $result;
	}

	/**
	 * Delete all settings for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return bool True on success.
	 */
	public static function delete_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'event_date_id' => $event_date_id ),
			array( '%d' )
		);

		return false !== $result;
	}
}
