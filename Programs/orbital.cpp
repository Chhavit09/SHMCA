#include <iostream>
#include <fstream>
#include <vector>
#include <cstdlib>
#include <ctime>
#include <cmath>
#include <unistd.h>

using namespace std;

// OOP Unit 2: Fundamentals of Operator Overloading

struct Vector3 
{
    double x, y, z;
    Vector3() { x = 0; y = 0; z = 0; }
    Vector3(double a, double b, double c) { x = a; y = b; z = c; }
    Vector3 operator+(const Vector3 &o) const { 
        return Vector3(x + o.x, y + o.y, z + o.z); 
    } Vector3 operator-(const Vector3 &o) const { 
        return Vector3(x - o.x, y - o.y, z - o.z); 
    } Vector3 operator*(double s) const { 
        return Vector3(x * s, y * s, z * s); 
    }
};

inline double dist3D(Vector3 a, Vector3 b) 
{
    double dx = a.x - b.x;
    double dy = a.y - b.y;
    double dz = a.z - b.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

#include "Queues_DSA.h"
#include "AVL_Tree.h"
#include "Satellites_OOP.h"
#include "FlightComputer.h"
#include "Chaos_Engine.h"

int REPAIR_DURATION_TICKS = 20;

Satellite* createSatelliteAroundEarth(int id, string name, int typeChoice) 
{
    double orbitRadius = 4200 + 600 + rand() % 400; 
    double angle = (rand() % 360) * 3.14159265 / 180.0;
    double speed = 6.5 + (rand() % 20) / 10.0;
    
    Vector3 pos(orbitRadius * cos(angle), orbitRadius * sin(angle), (rand() % 200 - 100) / 10.0);
    Vector3 vel(-sin(angle) * speed, cos(angle) * speed, 0);

    if (typeChoice == 1) 
    {
        return new CommunicationSatellite(id, name, pos, vel);
    } 
    else 
    {
        return new ImagingSatellite(id, name, pos, vel);
    }
}

int main() 
{
    srand((unsigned) time(0));
    cout << "---------------------------------\n";
    cout << " ORBITAL - Earth Orbit Edition\n";
    cout << "---------------------------------\n\n";

    int numSats;
    cout << "How many satellites in Earth orbit? (1-6): ";
    cin >> numSats;
    if (numSats < 1) numSats = 1;
    if (numSats > 6) numSats = 6;

    vector<Satellite*> satellites;
    for (int i = 0; i < numSats; i++) 
    {
        string name;
        int typeChoice;
        cout << "\nSatellite #" << (i + 1) << " Name (no spaces): ";
        cin >> name;
        cout << "Type (1: Communication, 2: Imaging): ";
        cin >> typeChoice;
        satellites.push_back(createSatelliteAroundEarth(i + 1, name, typeChoice));
    }
    int totalTicks, debrisPerSat;
    cout << "\nTicks to run? (recommended 100-300): "; 
    cin >> totalTicks;
    cout << "Repair duration ticks? (recommended 15-30): "; 
    cin >> REPAIR_DURATION_TICKS;
    cout << "Starting debris per satellite? (recommended 4-8): "; 
    cin >> debrisPerSat;

    ofstream logFile("blackbox.txt");
    logFile << "----- ORBITAL BLACKBOX LOG -----\n";
    
    vector<Debris> debrisList;
    int nextDebrisId = 1;
    for (int s = 0; s < satellites.size(); s++) 
    {
        for (int i = 0; i < debrisPerSat; i++) 
        {
            Debris d; 
            d.id = nextDebrisId++;
            d.pos = satellites[s]->getPos() + Vector3(rand() % 120 - 60, rand() % 120 - 60, rand() % 120 - 60);
            d.vel = satellites[s]->getVel() + Vector3((rand() % 70 - 35) / 100.0, (rand() % 70 - 35) / 100.0, (rand() % 70 - 35) / 100.0);
            debrisList.push_back(d);
        }
    }
    // OOP Unit 2: Instantiate the FlightComputer object

    FlightComputer flightComputer; 
    double simTime = 0, dt = 1.0;
    const double WATCH_DIST = 15.0;
    for (int tick = 1; tick <= totalTicks; tick++) {
        simTime += dt;
        runChaosEngine(satellites, debrisList, nextDebrisId, logFile, simTime);
        for (int i = 0; i < debrisList.size(); i++) {
            debrisList[i].pos = debrisList[i].pos + debrisList[i].vel * dt;
        }

        // OOP Unit 2: Instantiate AVLTree object

        AVLTree tree;
        for (int i = 0; i < debrisList.size(); i++) {
            tree.insert(getSectorKey(debrisList[i].pos), debrisList[i].id);
        }
        for (int i = 0; i < satellites.size(); i++) {
            if (satellites[i]->isDisabled()) { 
                satellites[i]->tickRepair(logFile, simTime); 
                continue; 
            }
            satellites[i]->moveOneStep(dt);
            flightComputer.handleHealthDecision(satellites[i], logFile, simTime);
        }
        MinHeap heap;
            for (int i = 0; i < satellites.size(); i++) 
            {
                if (satellites[i]->isDisabled()) 
                    continue;
                Vector3 sp = satellites[i]->getPos();
                long long bx = floor(sp.x / 100.0);
                long long by = floor(sp.y / 100.0);
                long long bz = floor(sp.z / 100.0);
                for (int dx = -1; dx <= 1; dx++) {
                    for (int dy = -1; dy <= 1; dy++) 
                    {
                        for (int dz = -1; dz <= 1; dz++) 
                        {
                            long long key = (bx + dx) * 1000000LL + (by + dy) * 1000LL + (bz + dz);
                            vector<int> ids = tree.search(key);
                            for (int k = 0; k < ids.size(); k++) 
                            {
                                Debris *d = findDebrisById(debrisList, ids[k]);
                                if (d != NULL && dist3D(sp, d->pos) < WATCH_DIST) 
                                {
                                    Threat t;
                                    t.satId = satellites[i]->getId();
                                    t.debId = d->id;
                                    t.distance = dist3D(sp, d->pos);
                                    heap.push(t);
                                }
                            }
                        }
                    }
                }
            }
    
