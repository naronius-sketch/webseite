-- Initial public sample catalogue only. Re-running never overwrites an agent's edits.
-- Run after schema.sql in the Supabase SQL editor.
begin;
do $seed$
declare initial_config jsonb := $initial_catalogue$
{
  "schemaVersion": 1,
  "business": {
    "name": "Wangechi Realty",
    "agentName": "",
    "whatsapp": "+254142406452",
    "email": "wangechirealty@gmail.com",
    "serviceArea": "Kenya",
    "viewingPolicy": {
      "mode": "quote",
      "fixedAmount": 1000,
      "enabled": false,
      "creditOnCompletion": true,
      "cancellationHours": 24
    }
  },
  "properties": [
    {
      "id": 1,
      "title": "A quieter kind of city living",
      "location": "Westlands, Nairobi",
      "city": "Nairobi",
      "category": "Apartment",
      "description": "A light-filled apartment with generous living spaces, a private balcony, and open views over leafy Westlands. Designed for an easy city routine with cafés, shops, and offices close by.",
      "purpose": "buy",
      "price": 34500000,
      "beds": 3,
      "baths": 3,
      "area": 210,
      "image": "/images/property-1.jpg",
      "status": "available",
      "tag": "Featured",
      "demo": true,
      "amenities": [
        "Private balcony",
        "Residents’ gym",
        "Secure parking",
        "Backup power"
      ]
    },
    {
      "id": 2,
      "title": "Your own piece of the coast",
      "location": "Vipingo, Kilifi",
      "city": "Kilifi",
      "category": "Villa",
      "description": "An airy coastal villa arranged around a shaded terrace and private pool. Natural finishes, a tropical garden, and sea breezes create a relaxed retreat in Vipingo.",
      "purpose": "buy",
      "price": 98000000,
      "beds": 4,
      "baths": 4,
      "area": 420,
      "image": "/images/property-2.jpg",
      "status": "available",
      "tag": "Coastal living",
      "demo": true,
      "amenities": [
        "Private pool",
        "Tropical garden",
        "Covered terrace",
        "Gated community"
      ]
    },
    {
      "id": 3,
      "title": "Room to settle in, space to grow",
      "location": "Karen, Nairobi",
      "city": "Nairobi",
      "category": "House",
      "description": "A welcoming family home on a green, quiet lane in Karen. Open-plan living leads into a private garden, with a dedicated study and generous bedrooms for everyday comfort.",
      "purpose": "rent",
      "price": 225000,
      "beds": 4,
      "baths": 3,
      "area": 310,
      "image": "/images/property-3.jpg",
      "status": "available",
      "tag": "New listing",
      "demo": true,
      "amenities": [
        "Private garden",
        "Home office",
        "Staff quarters",
        "Covered parking"
      ]
    },
    {
      "id": 4,
      "title": "Fresh mornings by the ocean",
      "location": "Nyali, Mombasa",
      "city": "Mombasa",
      "category": "Apartment",
      "description": "A bright apartment in a peaceful Nyali development, with a wide balcony and shared swimming pool. A comfortable base for coastal living close to beaches and neighbourhood shops.",
      "purpose": "rent",
      "price": 90000,
      "beds": 2,
      "baths": 2,
      "area": 125,
      "image": "/images/property-4.jpg",
      "status": "available",
      "tag": "Coastal living",
      "demo": true,
      "amenities": [
        "Shared pool",
        "Ocean-facing balcony",
        "Lift access",
        "Secure parking"
      ]
    },
    {
      "id": 5,
      "title": "A little more room for possibility",
      "location": "Riat Hills, Kisumu",
      "city": "Kisumu",
      "category": "Land",
      "description": "An illustrative half-acre residential plot in the Riat Hills area, offering space to plan a future home and enjoy expansive views. Any purchase would require independent title, survey, and planning checks.",
      "purpose": "buy",
      "price": 7800000,
      "beds": 0,
      "baths": 0,
      "area": 2023,
      "image": "/images/property-5.jpg",
      "status": "available",
      "tag": "New listing",
      "demo": true,
      "amenities": [
        "Half-acre plot",
        "Road access",
        "Elevated setting",
        "Residential area"
      ]
    },
    {
      "id": 6,
      "title": "An easy rhythm in the heart of town",
      "location": "Kilimani, Nairobi",
      "city": "Nairobi",
      "category": "Apartment",
      "description": "A contemporary apartment with thoughtful storage, warm interiors, and a roomy balcony. Set in Kilimani with convenient access to restaurants, schools, and daily essentials.",
      "purpose": "rent",
      "price": 165000,
      "beds": 3,
      "baths": 2,
      "area": 180,
      "image": "/images/property-6.jpg",
      "status": "available",
      "tag": "Featured",
      "demo": true,
      "amenities": [
        "Residents’ gym",
        "Private balcony",
        "Backup power",
        "24-hour security"
      ]
    },
    {
      "id": 7,
      "title": "A home with a gentler pace",
      "location": "Milimani, Kisumu",
      "city": "Kisumu",
      "category": "House",
      "description": "A single-storey home in leafy Milimani with a generous lawn and shaded outdoor seating. A practical layout brings the living room, dining area, and garden together for relaxed family life.",
      "purpose": "buy",
      "price": 18500000,
      "beds": 3,
      "baths": 2,
      "area": 230,
      "image": "/images/property-7.jpg",
      "status": "available",
      "tag": "Featured",
      "demo": true,
      "amenities": [
        "Private garden",
        "Covered veranda",
        "Water storage",
        "On-site parking"
      ]
    },
    {
      "id": 8,
      "title": "Sunshine, stillness, and space",
      "location": "Mtwapa, Kilifi",
      "city": "Kilifi",
      "category": "House",
      "description": "A comfortable home in a quiet Mtwapa neighbourhood, with a sheltered veranda and enclosed garden. Ideal for a slower coastal routine with local markets and amenities nearby.",
      "purpose": "rent",
      "price": 65000,
      "beds": 3,
      "baths": 2,
      "area": 165,
      "image": "/images/property-8.jpg",
      "status": "available",
      "tag": "New listing",
      "demo": true,
      "amenities": [
        "Enclosed garden",
        "Shaded veranda",
        "Water storage",
        "Private parking"
      ]
    }
  ]
}
$initial_catalogue$::jsonb;
begin
  perform public.site_validate_catalogue(initial_config);
  insert into public.site_catalogues(id, config, revision)
  values ('draft', initial_config, 1), ('published', initial_config, 1)
  on conflict (id) do nothing;
end;
$seed$;
commit;
