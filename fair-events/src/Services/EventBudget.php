<?php
/**
 * Event-level finance budget link
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * Stores and resolves the fair-finance budget linked to an event.
 *
 * The link is stored as post meta on the event's linked post (see
 * EventDates::get_resolved_event_id()) rather than on the event_date row, so
 * every occurrence of a recurring series — each its own event_date row —
 * shares one setting. An event with no linked post (link-only or never
 * linked) has nowhere to store the meta and always resolves to no budget.
 */
class EventBudget {

	/**
	 * Post meta key storing the linked budget ID.
	 *
	 * @var string
	 */
	const META_KEY = '_fair_events_budget_id';

	/**
	 * Budget IDs already resolved during this request, keyed by linked post
	 * ID. Caches misses (null) too, so a repeatedly-resolved deleted/missing
	 * budget doesn't re-query on every call.
	 *
	 * @var array<int, int|null>
	 */
	private static $post_budget_cache = array();

	/**
	 * Get the budget ID linked to an event date's underlying event.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int|null Budget ID, or null when unlinked, unset, deleted, or
	 *                   fair-finance is inactive.
	 */
	public static function get_budget_id( $event_date_id ) {
		$post_id = self::resolve_post_id( $event_date_id );

		return $post_id ? self::get_budget_id_for_post( $post_id ) : null;
	}

	/**
	 * Get the budget ID stored on an event's linked post directly.
	 *
	 * @param int $post_id Linked post ID.
	 * @return int|null Budget ID, or null when unset, deleted, or
	 *                   fair-finance is inactive.
	 */
	public static function get_budget_id_for_post( $post_id ) {
		$post_id = (int) $post_id;

		if ( array_key_exists( $post_id, self::$post_budget_cache ) ) {
			return self::$post_budget_cache[ $post_id ];
		}

		$budget_id                           = self::resolve_budget_id_for_post( $post_id );
		self::$post_budget_cache[ $post_id ] = $budget_id;

		return $budget_id;
	}

	/**
	 * Set (or clear) the budget linked to an event date's underlying event.
	 *
	 * Applies to the whole event: a generated occurrence resolves to the same
	 * linked post as its master (see EventDates::get_resolved_event_id()), so
	 * every occurrence of a series shares this setting. Existing financial
	 * entries already assigned to a budget are never touched here.
	 *
	 * @param int      $event_date_id Event date ID.
	 * @param int|null $budget_id     Budget ID to link, or null to clear.
	 * @return bool True on success, false if the event has no linked post.
	 */
	public static function set_budget_id( $event_date_id, $budget_id ) {
		$post_id = self::resolve_post_id( $event_date_id );
		if ( ! $post_id ) {
			return false;
		}

		if ( $budget_id ) {
			update_post_meta( $post_id, self::META_KEY, (int) $budget_id );
			self::$post_budget_cache[ $post_id ] = (int) $budget_id;
		} else {
			delete_post_meta( $post_id, self::META_KEY );
			self::$post_budget_cache[ $post_id ] = null;
		}

		return true;
	}

	/**
	 * Resolve the event date's shared linked post ID.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int|null Linked post ID, or null when unlinked or not found.
	 */
	private static function resolve_post_id( $event_date_id ) {
		$event_date = EventDates::get_by_id( (int) $event_date_id );

		return $event_date ? $event_date->get_resolved_event_id() : null;
	}

	/**
	 * Look up and validate the stored budget ID for a linked post, uncached.
	 *
	 * @param int $post_id Linked post ID.
	 * @return int|null
	 */
	private static function resolve_budget_id_for_post( $post_id ) {
		if ( ! class_exists( '\FairFinance\Models\Budget' ) ) {
			return null;
		}

		$budget_id = (int) get_post_meta( $post_id, self::META_KEY, true );
		if ( ! $budget_id ) {
			return null;
		}

		// A stored ID whose budget was since deleted (or renamed away, which
		// doesn't change the ID) resolves to no budget rather than exposing
		// something that no longer exists.
		return \FairFinance\Models\Budget::get_by_id( $budget_id ) ? $budget_id : null;
	}
}
