<?php
/**
 * Public view of occurrence marketing assets.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Frontend\MarketingAssetsPage;
use FairEventsExperimental\Models\MarketingAssetRepository;
use FairEventsShared\Helpers\DisplayText;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * The anonymous projection of marketing assets (#2430).
 *
 * Every occurrence is discoverable while the `marketing-assets` bundle is
 * on, whatever its publication status: the assets support preparing
 * marketing material, possibly before the event is announced. Nothing else
 * of the event is exposed: an occurrence is named by its public title only
 * when it is published and publicly viewable, else by its ID.
 *
 * An asset carries its label, its exact text, its image's URL, MIME type
 * and alternative text, and the name and surname of the team members whose
 * link was saved with the public-name disclosure. Schedule links,
 * attachment IDs and metadata, and every other profile field are left out.
 * Member filters use keys scoped to the occurrence, so a profile ID never
 * appears and two people with the same name stay distinct.
 */
class PublicMarketingAssets {

	/**
	 * Storage.
	 *
	 * @var MarketingAssetRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 *
	 * @param MarketingAssetRepository|null $repository Storage.
	 */
	public function __construct( $repository = null ) {
		$this->repository = $repository ? $repository : new MarketingAssetRepository();
	}

	/**
	 * One page of the occurrences that have an asset page: every event
	 * date, newest first.
	 *
	 * @param int $page     Page, from 1.
	 * @param int $per_page Page size.
	 * @return array{items: array[], total: int, page: int, per_page: int, total_pages: int}
	 */
	public function discover( $page, $per_page ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_event_dates';
		$total = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table ) );
		$ids   = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					'SELECT id FROM %i ORDER BY id DESC LIMIT %d OFFSET %d',
					$table,
					(int) $per_page,
					( (int) $page - 1 ) * (int) $per_page
				)
			)
		);

		$dates = EventDates::get_by_ids( $ids );
		$items = array();
		foreach ( $ids as $id ) {
			if ( isset( $dates[ $id ] ) ) {
				$items[] = self::occurrence( $dates[ $id ] );
			}
		}

		return array(
			'items'       => $items,
			'total'       => $total,
			'page'        => (int) $page,
			'per_page'    => (int) $per_page,
			'total_pages' => (int) max( 1, (int) ceil( $total / $per_page ) ),
		);
	}

	/**
	 * How an occurrence is identified in public: its ID, its public title
	 * (null unless published) and its asset page.
	 *
	 * @param EventDates $event_date Event date.
	 * @return array{event_date_id: int, title: string|null, url: string}
	 */
	public static function occurrence( EventDates $event_date ) {
		return array(
			'event_date_id' => (int) $event_date->id,
			'title'         => self::public_title( $event_date ),
			'url'           => MarketingAssetsPage::url( (int) $event_date->id ),
		);
	}

	/**
	 * The occurrence's title as plain text when the event is published and
	 * its page (if any) is publicly viewable; null otherwise, and for an
	 * empty title.
	 *
	 * @param EventDates $event_date Event date.
	 * @return string|null
	 */
	public static function public_title( EventDates $event_date ) {
		if ( 'publish' !== $event_date->publication_status ) {
			return null;
		}

		if ( 'post' === $event_date->link_type ) {
			$post = get_post( (int) $event_date->get_resolved_event_id() );
			if ( ! $post || ! is_post_publicly_viewable( $post ) || post_password_required( $post ) ) {
				return null;
			}
		}

		$title = DisplayText::event_title( $event_date->get_display_title(), '' );
		return '' === $title ? null : $title;
	}

	/**
	 * One page of an occurrence's assets, with the filters it offers.
	 *
	 * `$label` keeps assets with exactly that label; `$member_key` keeps
	 * assets publishing that member's name. An unknown key matches nothing.
	 *
	 * @param EventDates  $event_date Event date.
	 * @param int         $page       Page, from 1.
	 * @param int         $per_page   Page size.
	 * @param string|null $label      Label filter.
	 * @param string|null $member_key Member filter key.
	 * @return array
	 */
	public function list_assets( EventDates $event_date, $page, $per_page, $label = null, $member_key = null ) {
		$event_date_id = (int) $event_date->id;
		$members       = $this->published_members( $event_date );

		$member_id = null;
		if ( null !== $member_key ) {
			foreach ( $members as $id => $member ) {
				if ( $member['key'] === $member_key ) {
					$member_id = $id;
				}
			}
		}

		if ( null !== $member_key && null === $member_id ) {
			$total = 0;
			$rows  = array();
		} else {
			$version = MarketingAssets::DISCLOSURE_VERSION;
			$total   = $this->repository->count_filtered( $event_date_id, $label, $member_id, $version );
			$rows    = $this->repository->page_filtered( $event_date_id, $label, $member_id, $version, $per_page, ( $page - 1 ) * $per_page );
		}

		return array_merge(
			self::occurrence( $event_date ),
			array(
				'index_url'   => MarketingAssetsPage::index_url(),
				'filters'     => array(
					'members' => array_values( $members ),
					'labels'  => $this->repository->labels_for_event_date( $event_date_id ),
				),
				'items'       => array_map(
					function ( $row ) use ( $members ) {
						return self::shape( $row, $members );
					},
					$rows
				),
				'total'       => $total,
				'page'        => (int) $page,
				'per_page'    => (int) $per_page,
				'total_pages' => (int) max( 1, (int) ceil( $total / $per_page ) ),
			)
		);
	}

	/**
	 * Members whose name the occurrence's assets publish and who are still
	 * on its team, with current profile names: `{ key, name, surname }`
	 * keyed by member ID, in name order.
	 *
	 * @param EventDates $event_date Event date.
	 * @return array<int, array>
	 */
	private function published_members( EventDates $event_date ) {
		$ids = $this->repository->published_member_ids( (int) $event_date->id, MarketingAssets::DISCLOSURE_VERSION );
		if ( ! $ids ) {
			return array();
		}

		$team = MarketingAssets::team( $event_date );
		$out  = array();
		foreach ( $ids as $id ) {
			if ( isset( $team[ $id ] ) ) {
				$out[ $id ] = array(
					'key'     => self::member_key( (int) $event_date->id, $id ),
					'name'    => (string) $team[ $id ]['name'],
					'surname' => (string) $team[ $id ]['surname'],
				);
			}
		}

		uasort(
			$out,
			static function ( $a, $b ) {
				return strcasecmp( trim( $a['name'] . ' ' . $a['surname'] ), trim( $b['name'] . ' ' . $b['surname'] ) );
			}
		);
		return $out;
	}

	/**
	 * A member's filter key on one occurrence. It reveals neither the
	 * profile ID nor whether the same person appears on another occurrence.
	 *
	 * @param int $event_date_id Event date ID.
	 * @param int $member_id     Member ID.
	 * @return string 16 hex characters.
	 */
	public static function member_key( $event_date_id, $member_id ) {
		return substr( hash_hmac( 'sha256', 'fair-marketing-member|' . (int) $event_date_id . '|' . (int) $member_id, wp_salt( 'auth' ) ), 0, 16 );
	}

	/**
	 * The public fields of one asset.
	 *
	 * @param array $row     Hydrated row.
	 * @param array $members Published members, keyed by ID.
	 * @return array
	 */
	private static function shape( array $row, array $members ) {
		$image = null;
		if ( $row['attachment_id'] ) {
			$described = MarketingAssets::describe_attachment( $row['attachment_id'] );
			if ( $described['available'] ) {
				$image = array(
					'url'       => $described['url'],
					'mime_type' => $described['mime_type'],
					'alt'       => $described['alt'],
				);
			}
		}

		$linked = array();
		foreach ( $row['disclosures'] as $member_id => $version ) {
			if ( $version >= MarketingAssets::DISCLOSURE_VERSION && isset( $members[ $member_id ] ) ) {
				$linked[] = $members[ $member_id ];
			}
		}

		return array(
			'id'                => (int) $row['id'],
			'label'             => $row['label'],
			'text'              => $row['text'],
			'image'             => $image,
			'image_unavailable' => null === $image && ( $row['image_removed'] || $row['attachment_id'] ),
			'members'           => $linked,
		);
	}
}
