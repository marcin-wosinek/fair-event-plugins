<?php
/**
 * Sales summary report contents.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Groups a period's event sales into one report (#2306).
 *
 * An organizer's report holds only the events that organizer owns. The
 * central report holds every organizer, each with its own events. An event
 * whose organizer can't be resolved now is left out of every report, so a
 * paused organizer's sales never move into another organizer's email.
 */
class SalesSummaryReport {

	/**
	 * Organizer directory.
	 *
	 * @var SalesSummaryOrganizers
	 */
	private $organizers;

	/**
	 * Constructor.
	 *
	 * @param SalesSummaryOrganizers $organizers Organizer directory.
	 */
	public function __construct( $organizers ) {
		$this->organizers = $organizers;
	}

	/**
	 * Build a report from a period's events.
	 *
	 * @param string $key       Report key.
	 * @param string $frequency Daily or weekly.
	 * @param array  $period    Period boundaries.
	 * @param array  $events    Events from {@see \FairEvents\Services\SalesSummaryStatistics::for_period()}.
	 * @return array|null `{ key, central, frequency, period, organizer, groups, empty }`,
	 *     each group `{ organizer, events }`; null when the report's
	 *     organizer can't be resolved.
	 */
	public function build( $key, $frequency, array $period, array $events ) {
		$central = SalesSummarySettings::CENTRAL === $key;
		if ( ! $this->organizers->report_available( $key ) ) {
			return null;
		}

		$by_organizer = array();
		foreach ( $events as $event ) {
			$owner = $this->organizers->owner_of( (int) $event['event_id'] );
			if ( null !== $owner ) {
				$by_organizer[ $owner ][] = $event;
			}
		}

		$organizer = $central ? $this->organizers->find( SalesSummarySettings::DEFAULT_ORGANIZER ) : $this->organizers->find( $key );
		$groups    = array();
		foreach ( $central ? $this->organizers->all() : array( $organizer ) as $member ) {
			$groups[] = array(
				'organizer' => $member,
				'events'    => $by_organizer[ $member['id'] ] ?? array(),
			);
		}

		$empty = true;
		foreach ( $groups as $group ) {
			if ( $group['events'] ) {
				$empty = false;
			}
		}

		return array(
			'key'       => $key,
			'central'   => $central,
			'frequency' => $frequency,
			'period'    => $period,
			'organizer' => $organizer,
			'groups'    => $groups,
			'empty'     => $empty,
		);
	}

	/**
	 * Who receives a report: its organizer's private notification
	 * addresses (the sitewide organizer's for the central report), or the
	 * report's fallback address when there is no valid one.
	 *
	 * @param array $report   Report from {@see self::build()}.
	 * @param array $settings Report settings.
	 * @return array{recipients: string[], fallback: bool}
	 */
	public static function recipients( array $report, array $settings ) {
		$recipients = SalesSummaryOrganizers::recipients( $report['organizer']['notification_emails'] ?? array() );
		if ( $recipients ) {
			return array(
				'recipients' => $recipients,
				'fallback'   => false,
			);
		}

		$fallback = SalesSummaryOrganizers::recipients( array( $settings['fallback_email'] ) );
		return array(
			'recipients' => $fallback,
			'fallback'   => true,
		);
	}
}
