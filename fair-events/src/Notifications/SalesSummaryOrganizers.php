<?php
/**
 * Organizers a sales summary can report on.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Models\EventDates;
use FairEvents\Settings\Organizer;

defined( 'WPINC' ) || die;

/**
 * Resolves organizers, their private recipients and event ownership for the
 * sales summaries (#2306).
 *
 * Fair Events itself knows the sitewide organizer only. Additional
 * organizers and the ownership of events assigned to them come from Fair
 * Events Experimental through two filters, hooked only while its organizer
 * management is available:
 *
 * - {@see self::ORGANIZERS_FILTER}: every organizer as
 *   `{ id, name, notification_emails }`, the sitewide one first.
 * - {@see self::EVENT_ORGANIZER_FILTER}: the ID of the organizer an event
 *   (a single event or a series master) belongs to.
 *
 * Without them, organizer resolution is unavailable: the sitewide
 * organizer's own summary keeps covering the events stored without an
 * assignment, while events assigned to an additional organizer are left out
 * of every summary (never regrouped under the sitewide organizer), and the
 * additional organizers' and the central summaries are paused.
 */
class SalesSummaryOrganizers {
	public const ORGANIZERS_FILTER      = 'fair_events_sales_summary_organizers';
	public const EVENT_ORGANIZER_FILTER = 'fair_events_sales_summary_event_organizer';

	/**
	 * Organizers from the filter, once per instance.
	 *
	 * @var array[]|null|false False until read.
	 */
	private $resolved = false;

	/**
	 * Whether additional organizers and event ownership can be resolved.
	 *
	 * @return bool
	 */
	public function resolution_available() {
		return null !== $this->resolved();
	}

	/**
	 * Every organizer, the sitewide one first.
	 *
	 * @return array[] `{ id, name, notification_emails }` each.
	 */
	public function all() {
		$resolved = $this->resolved();
		return null === $resolved ? array( self::sitewide() ) : $resolved;
	}

	/**
	 * One organizer.
	 *
	 * @param string $id Organizer ID.
	 * @return array|null
	 */
	public function find( $id ) {
		foreach ( $this->all() as $organizer ) {
			if ( $organizer['id'] === (string) $id ) {
				return $organizer;
			}
		}
		return null;
	}

	/**
	 * Whether a report can be generated now.
	 *
	 * @param string $key Report key.
	 * @return bool
	 */
	public function report_available( $key ) {
		if ( SalesSummarySettings::DEFAULT_ORGANIZER === $key ) {
			return true;
		}
		if ( ! $this->resolution_available() ) {
			return false;
		}
		return SalesSummarySettings::CENTRAL === $key || null !== $this->find( $key );
	}

	/**
	 * The organizer an event belongs to.
	 *
	 * @param int $owner_id Event date that owns the assignment: a single event or a series master.
	 * @return string|null Organizer ID, or null when it can't be resolved now.
	 */
	public function owner_of( $owner_id ) {
		if ( $this->resolution_available() ) {
			$id = apply_filters( self::EVENT_ORGANIZER_FILTER, null, (int) $owner_id );
			return is_string( $id ) && '' !== $id ? $id : null;
		}

		$stored = method_exists( EventDates::class, 'get_organizer_id' ) ? EventDates::get_organizer_id( (int) $owner_id ) : null;
		return null === $stored ? SalesSummarySettings::DEFAULT_ORGANIZER : null;
	}

	/**
	 * Normalized, de-duplicated recipients: valid addresses only, the first
	 * spelling of each address kept, compared without regard to case.
	 *
	 * @param mixed $emails Raw addresses.
	 * @return string[]
	 */
	public static function recipients( $emails ) {
		$recipients = array();
		foreach ( is_array( $emails ) ? $emails : array() as $email ) {
			$address = IndividualEmailSettings::parse_recipient( is_string( $email ) ? $email : '' );
			if ( null === $address || '' === $address ) {
				continue;
			}
			$recipients[ strtolower( $address ) ] = $recipients[ strtolower( $address ) ] ?? $address;
		}
		return array_values( $recipients );
	}

	/**
	 * The sitewide organizer, named after the site when it has no name.
	 *
	 * @return array
	 */
	public static function sitewide() {
		$identity = Organizer::get();
		$name     = '' !== $identity['name'] ? $identity['name'] : wp_specialchars_decode( (string) get_option( 'blogname' ), ENT_QUOTES );

		return array(
			'id'                  => SalesSummarySettings::DEFAULT_ORGANIZER,
			'name'                => (string) $name,
			'notification_emails' => Organizer::get_notification_emails(),
		);
	}

	/**
	 * Organizers from the filter, or null when nothing provides them.
	 *
	 * @return array[]|null
	 */
	private function resolved() {
		if ( false !== $this->resolved ) {
			return $this->resolved;
		}

		$list = apply_filters( self::ORGANIZERS_FILTER, null );
		if ( ! is_array( $list ) ) {
			$this->resolved = null;
			return null;
		}

		$organizers = array();
		foreach ( $list as $organizer ) {
			if ( ! is_array( $organizer ) || empty( $organizer['id'] ) || ! SalesSummarySettings::valid_key( (string) $organizer['id'] ) || SalesSummarySettings::CENTRAL === $organizer['id'] ) {
				continue;
			}
			$organizers[ (string) $organizer['id'] ] = array(
				'id'                  => (string) $organizer['id'],
				'name'                => (string) ( $organizer['name'] ?? '' ),
				'notification_emails' => self::recipients( $organizer['notification_emails'] ?? array() ),
			);
		}
		if ( ! isset( $organizers[ SalesSummarySettings::DEFAULT_ORGANIZER ] ) ) {
			$organizers = array( SalesSummarySettings::DEFAULT_ORGANIZER => self::sitewide() ) + $organizers;
		}
		if ( '' === $organizers[ SalesSummarySettings::DEFAULT_ORGANIZER ]['name'] ) {
			$organizers[ SalesSummarySettings::DEFAULT_ORGANIZER ]['name'] = self::sitewide()['name'];
		}

		$this->resolved = array_values( $organizers );
		return $this->resolved;
	}
}
