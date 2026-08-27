<?php
/**
 * Synchronize event-date links across Polylang post translations.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;

/**
 * Resolves Polylang groups and applies group-aware link mutations.
 */
class PostTranslationLinks {
	/**
	 * Translation groups currently being synchronized.
	 *
	 * @var array<string, bool>
	 */
	private static $syncing = array();

	/**
	 * Register Polylang synchronization hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'pll_save_post', array( static::class, 'sync_saved_post' ), 10, 1 );
	}

	/**
	 * Resolve a post's translation group with the requested post first.
	 *
	 * @param int $post_id Requested post ID.
	 * @return int[] Unique positive post IDs.
	 */
	public static function resolve_group( $post_id ) {
		$post_id = absint( $post_id );
		if ( ! $post_id || ! function_exists( 'pll_get_post_translations' ) ) {
			return $post_id ? array( $post_id ) : array();
		}

		$translations = pll_get_post_translations( $post_id );
		if ( ! is_array( $translations ) ) {
			return array( $post_id );
		}

		$group = array( $post_id );
		foreach ( $translations as $translated_id ) {
			$translated_id = absint( $translated_id );
			if ( $translated_id ) {
				$group[] = $translated_id;
			}
		}

		return array_values( array_unique( $group ) );
	}

	/**
	 * Link a complete translation group to an event date.
	 *
	 * @param EventDates $event_date   Requested event date or generated occurrence.
	 * @param int        $post_id      Explicitly requested post ID.
	 * @return EventDates Event date on which links are stored.
	 */
	public static function link_group( $event_date, $post_id ) {
		$target = self::resolve_link_event_date( $event_date );
		if ( ! $target ) {
			return $event_date;
		}

		foreach ( self::resolve_group( $post_id ) as $translated_id ) {
			$existing = EventDates::get_by_event_id( $translated_id );
			if ( $existing ) {
				$existing = self::resolve_link_event_date( $existing );
			}
			if ( $existing && (int) $existing->id !== (int) $target->id ) {
				self::detach_post( $existing, $translated_id );
			}
			EventDates::add_linked_post( $target->id, $translated_id );
		}

		if ( ! $target->event_id ) {
			EventDates::update_by_id(
				$target->id,
				array(
					'event_id'  => absint( $post_id ),
					'link_type' => 'post',
				)
			);
			self::propagate_primary( $target, absint( $post_id ) );
		}

		return $target;
	}

	/**
	 * Unlink a complete translation group from an event date.
	 *
	 * @param EventDates $event_date Requested event date or generated occurrence.
	 * @param int        $post_id    Explicitly requested post ID.
	 * @return EventDates Event date on which links are stored.
	 */
	public static function unlink_group( $event_date, $post_id ) {
		$target = self::resolve_link_event_date( $event_date );
		if ( ! $target ) {
			return $event_date;
		}

		foreach ( self::resolve_group( $post_id ) as $translated_id ) {
			$current = EventDates::get_by_id( $target->id );
			self::detach_post( $current, $translated_id );
		}

		return EventDates::get_by_id( $target->id );
	}

	/**
	 * Synchronize a post after Polylang saves its translation relationships.
	 *
	 * @param int $post_id Saved post ID.
	 * @return void
	 */
	public static function sync_saved_post( $post_id ) {
		$post_id = absint( $post_id );
		$post    = get_post( $post_id );
		if ( ! $post || ! in_array( $post->post_type, Settings::get_enabled_post_types(), true ) ) {
			return;
		}

		$group = self::resolve_group( $post_id );
		if ( count( $group ) < 2 ) {
			return;
		}

		$guard_group = $group;
		sort( $guard_group, SORT_NUMERIC );
		$guard_key = implode( ':', $guard_group );
		if ( isset( self::$syncing[ $guard_key ] ) ) {
			return;
		}

		$event_dates = array();
		foreach ( array_diff( $group, array( $post_id ) ) as $translated_id ) {
			$linked = EventDates::get_by_event_id( $translated_id );
			if ( $linked ) {
				$linked                           = self::resolve_link_event_date( $linked );
				$event_dates[ (int) $linked->id ] = $linked;
			}
		}

		if ( 1 !== count( $event_dates ) ) {
			return;
		}

		self::$syncing[ $guard_key ] = true;
		try {
			self::link_group( reset( $event_dates ), $post_id );
		} finally {
			unset( self::$syncing[ $guard_key ] );
		}
	}

	/**
	 * Resolve generated occurrences to their series master.
	 *
	 * @param EventDates $event_date Event date.
	 * @return EventDates|null Link-owning event date.
	 */
	private static function resolve_link_event_date( $event_date ) {
		if ( $event_date && 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			$master = EventDates::get_by_id( $event_date->master_id );
			return $master ? $master : $event_date;
		}
		return $event_date;
	}

	/**
	 * Detach one post and promote or clear the primary when necessary.
	 *
	 * @param EventDates $event_date Event date.
	 * @param int        $post_id    Post ID.
	 * @return void
	 */
	private static function detach_post( $event_date, $post_id ) {
		if ( ! $event_date ) {
			return;
		}

		EventDates::remove_linked_post( $event_date->id, $post_id );
		if ( (int) $event_date->event_id !== (int) $post_id ) {
			return;
		}

		$remaining = EventDates::get_linked_post_ids( $event_date->id );
		if ( $remaining ) {
			$new_primary = (int) $remaining[0];
			EventDates::update_by_id( $event_date->id, array( 'event_id' => $new_primary ) );
			self::propagate_primary( $event_date, $new_primary );
			return;
		}

		EventDates::update_by_id(
			$event_date->id,
			array(
				'event_id'  => null,
				'link_type' => 'none',
			)
		);
		self::propagate_primary( $event_date, null );
	}

	/**
	 * Propagate a master's final primary to generated occurrences.
	 *
	 * @param EventDates $event_date Master or single event date.
	 * @param int|null   $post_id    Primary post ID, or null.
	 * @return void
	 */
	private static function propagate_primary( $event_date, $post_id ) {
		if ( 'master' !== $event_date->occurrence_type ) {
			return;
		}
		foreach ( EventDates::get_generated_by_master_id( $event_date->id, true ) as $child ) {
			EventDates::update_by_id( $child->id, array( 'event_id' => $post_id ) );
		}
	}
}
