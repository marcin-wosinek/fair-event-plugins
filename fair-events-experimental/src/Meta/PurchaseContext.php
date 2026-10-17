<?php
/**
 * Event context of a Meta checkout or purchase.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/**
 * Resolves which event and occurrence a transaction paid for, from its
 * registrations — never from the checkout page's URL.
 *
 * A transaction reports one occurrence: the earliest-starting occurrence
 * among its own registrations (a single-occurrence checkout has only one).
 * The result holds only the fields that could be resolved, and resolution
 * never throws, so missing registrations or event details cannot block
 * conversion delivery or payment completion.
 */
class PurchaseContext {
	/** @param object $transaction Transaction. @return array {@see normalize()} result. */
	public function for_transaction( $transaction ) {
		if ( ! $this->available() ) {
			return array();
		}
		try {
			$occurrences = array();
			foreach ( $this->signup_ids( $transaction ) as $signup_id ) {
				$signup = $this->signup( (int) $signup_id );
				// Re-check ownership: a registration counts only for its own transaction.
				if ( ! $signup || (int) $signup->transaction_id !== (int) $transaction->id ) {
					continue;
				}
				$occurrence = $this->occurrence( (int) $signup->event_date_id );
				if ( $occurrence ) {
					$occurrences[] = $occurrence;
				}
			}
			$occurrence = self::select_occurrence( $occurrences );
			return $occurrence ? $this->from_occurrence( $occurrence ) : array();
		} catch ( \Throwable $e ) {
			return array();
		}
	}

	/** @return bool Whether Fair Events' registration and date models are loaded. */
	protected function available() {
		return class_exists( \FairEvents\Models\EventSignup::class ) && class_exists( \FairEvents\Models\EventDates::class );
	}

	/** @param object $transaction Transaction. @return int[] */
	protected function signup_ids( $transaction ) {
		return \FairEvents\Models\EventSignup::resolve_signup_ids_from_transaction( $transaction );
	}

	/** @param int $signup_id Signup ID. @return object|null */
	protected function signup( $signup_id ) {
		return \FairEvents\Models\EventSignup::get_by_id( $signup_id );
	}

	/** @param int $event_date_id Event date ID. @return object|null */
	protected function occurrence( $event_date_id ) {
		return $event_date_id ? \FairEvents\Models\EventDates::get_by_id( $event_date_id ) : null;
	}

	/** @param int $post_id Post ID. @return string|null */
	protected function post_title( $post_id ) {
		$post = get_post( $post_id );
		return $post ? (string) $post->post_title : null;
	}

	/**
	 * The earliest-starting occurrence; equal starts go to the lower ID, and
	 * an occurrence without a start sorts last.
	 *
	 * @param object[] $occurrences Registered occurrences. @return object|null
	 */
	public static function select_occurrence( $occurrences ) {
		usort(
			$occurrences,
			static function ( $a, $b ) {
				$a_start = (string) ( $a->start_datetime ?? '' );
				$b_start = (string) ( $b->start_datetime ?? '' );
				if ( $a_start !== $b_start ) {
					if ( '' === $a_start || '' === $b_start ) {
						return '' === $a_start ? 1 : -1;
					}
					return strcmp( $a_start, $b_start );
				}
				return (int) $a->id <=> (int) $b->id;
			}
		);
		return $occurrences ? $occurrences[0] : null;
	}

	/**
	 * Context of one occurrence. The stable event identifier is the resolved
	 * WordPress post ID, or `event-date:<id>` of the single or series-master
	 * row for an event without a post. The title is the post's title, like
	 * the checkout's own description — a row's `link_type` may be unset, so
	 * the display title alone can miss it — or the stored display title for
	 * an event without a post.
	 *
	 * @param object $occurrence EventDates instance. @return array
	 */
	protected function from_occurrence( $occurrence ) {
		$post_id = method_exists( $occurrence, 'get_resolved_event_id' ) ? (int) $occurrence->get_resolved_event_id() : 0;
		$title   = $post_id ? $this->post_title( $post_id ) : null;
		if ( ( null === $title || '' === $title ) && method_exists( $occurrence, 'get_display_title' ) ) {
			$title = $occurrence->get_display_title();
		}
		if ( $post_id ) {
			$event_id = (string) $post_id;
		} else {
			$root_id  = 'generated' === ( $occurrence->occurrence_type ?? '' ) && ! empty( $occurrence->master_id ) ? (int) $occurrence->master_id : (int) $occurrence->id;
			$event_id = 'event-date:' . $root_id;
		}
		return self::normalize(
			array(
				'content_name'     => $title,
				'content_ids'      => array( $event_id ),
				'event_date_id'    => (int) $occurrence->id,
				'event_start_date' => substr( (string) ( $occurrence->start_datetime ?? '' ), 0, 10 ),
			)
		);
	}

	/**
	 * Keep only well-formed context fields, each one independently: a
	 * plain-text `content_name`, `content_ids` of post IDs or
	 * `event-date:<id>` strings, a positive `event_date_id` and a
	 * `YYYY-MM-DD` `event_start_date`. Anything else — including malformed
	 * stored snapshots — is dropped, never repaired.
	 *
	 * @param mixed $context Raw context. @return array
	 */
	public static function normalize( $context ) {
		if ( ! is_array( $context ) ) {
			return array();
		}
		$clean = array();
		if ( isset( $context['content_name'] ) && is_string( $context['content_name'] ) ) {
			$name = sanitize_text_field( html_entity_decode( $context['content_name'], ENT_QUOTES, 'UTF-8' ) );
			if ( '' !== $name ) {
				$clean['content_name'] = $name;
			}
		}
		if ( isset( $context['content_ids'] ) && is_array( $context['content_ids'] ) ) {
			$ids = array_values(
				array_filter(
					$context['content_ids'],
					static fn( $id ) => is_string( $id ) && preg_match( '/^(?:[1-9]\d*|event-date:[1-9]\d*)$/', $id )
				)
			);
			if ( $ids ) {
				$clean['content_ids'] = $ids;
			}
		}
		if ( isset( $context['event_date_id'] ) && is_int( $context['event_date_id'] ) && $context['event_date_id'] > 0 ) {
			$clean['event_date_id'] = $context['event_date_id'];
		}
		if ( isset( $context['event_start_date'] ) && is_string( $context['event_start_date'] ) && preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $context['event_start_date'], $date ) && checkdate( (int) $date[2], (int) $date[3], (int) $date[1] ) ) {
			$clean['event_start_date'] = $context['event_start_date'];
		}
		return $clean;
	}
}
