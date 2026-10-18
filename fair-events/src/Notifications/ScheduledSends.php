<?php
/**
 * Queued notification sends.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Finds and removes queued WP-Cron sends of one configuration.
 *
 * Every type has one cron hook. Each queued send carries the week it is for
 * and the configuration ID: `array( $week, $config_id )`. Sends queued before
 * configurations had IDs carry the week only.
 */
class ScheduledSends {

	/**
	 * Queued events of a hook.
	 *
	 * @param string $hook Cron hook.
	 * @return array[] Each `array( timestamp, args )`.
	 */
	public static function events( $hook ) {
		$events = array();
		foreach ( (array) _get_cron_array() as $timestamp => $hooks ) {
			foreach ( $hooks[ $hook ] ?? array() as $event ) {
				$events[] = array( (int) $timestamp, array_values( (array) ( $event['args'] ?? array() ) ) );
			}
		}
		return $events;
	}

	/**
	 * Remove every queued send of one configuration.
	 *
	 * @param string $hook      Cron hook.
	 * @param string $config_id Configuration ID.
	 * @return void
	 */
	public static function clear( $hook, $config_id ) {
		foreach ( self::events( $hook ) as list( $timestamp, $args ) ) {
			if ( 2 === count( $args ) && $args[1] === $config_id ) {
				wp_unschedule_event( $timestamp, $hook, $args );
			}
		}
	}

	/**
	 * Queued sends from before configurations had IDs.
	 *
	 * @param string $hook Cron hook.
	 * @return array[] Each `array( timestamp, args )`.
	 */
	public static function without_configuration( $hook ) {
		return array_values(
			array_filter(
				self::events( $hook ),
				static function ( $event ) {
					return 1 === count( $event[1] );
				}
			)
		);
	}
}
